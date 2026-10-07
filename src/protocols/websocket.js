import { WebSocket } from "ws";
import { z } from "zod";
import { safeLookup } from "../services/ssrf.js";
import { effectiveLimits } from "../services/executor.js";
import { resolve as resolveVars } from "../services/variables.js";
import { prepareTarget, decodePayload, describePayload } from "./common.js";

export const WebSocketData = z.object({
  subprotocols: z.string().max(500).default(""), // comma separated, e.g. "graphql-ws, chat"
  message: z.string().max(1_000_000).default(""), // draft of the next message
  messageFormat: z.enum(["text", "base64", "hex"]).default("text"),
});

const SCHEMES = { ws: "ws", wss: "wss", http: "ws", https: "wss" };

export const SendSchema = z.object({
  data: z.string().max(10_000_000).default(""),
  format: z.enum(["text", "base64", "hex"]).default("text"),
});
export const CloseSchema = z.object({
  code: z.number().int().refine((c) => c === 1000 || (c >= 3000 && c <= 4999), "Close code must be 1000 or 3000-4999").default(1000),
  reason: z.string().max(100).default(""),
});

/** Opens a WebSocket. Resolves once the handshake finished; rejects with the reason when it failed. */
export function connectWebSocket({ request, inherited, data, limits, ctx, vars }) {
  const cfg = WebSocketData.parse(data ?? {});
  const { url, headers } = prepareTarget(request, inherited, { schemes: SCHEMES, defaultScheme: "ws" });
  const lim = effectiveLimits(limits);
  const subprotocols = cfg.subprotocols.split(",").map((s) => s.trim()).filter(Boolean);
  return new Promise((resolve, reject) => {
    let opened = false;
    const sock = new WebSocket(url, subprotocols, {
      headers,
      lookup: safeLookup, // validates the address actually connected to (DNS rebinding)
      handshakeTimeout: Number.isFinite(lim.timeoutMs) ? lim.timeoutMs : undefined,
      maxPayload: Number.isFinite(lim.maxBytes) ? lim.maxBytes : 0,
      followRedirects: false,
    });
    let upgrade = null;
    sock.on("upgrade", (res) => (upgrade = res));
    const show = (buf) => describePayload(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    const driver = {
      async act(action, p) {
        if (action === "send") {
          const { data: d, format } = SendSchema.parse(p);
          const buf = decodePayload(format === "text" ? resolveVars(d, vars ?? {}) : d, format);
          await new Promise((ok, no) => sock.send(buf, { binary: format !== "text" }, (e) => (e ? no(e) : ok())));
          ctx.emit("message", { direction: "out", frame: format === "text" ? "text" : "binary", binary: format !== "text", size: buf.length, data: format === "text" ? buf.toString("utf8") : buf.toString("base64") });
        } else if (action === "ping" || action === "pong") {
          const buf = Buffer.from(String(p?.data ?? ""), "utf8");
          if (buf.length > 125) throw new Error("Control frames carry at most 125 bytes");
          await new Promise((ok, no) => sock[action](buf, undefined, (e) => (e ? no(e) : ok())));
          ctx.emit(action, { direction: "out", ...show(buf) });
        } else if (action === "close") {
          const { code, reason } = CloseSchema.parse(p ?? {});
          sock.close(code, reason);
          ctx.emit("closing", { code, reason });
        } else throw new Error(`Unknown action "${action}"`);
        return { ok: true };
      },
      close() {
        sock.terminate();
      },
    };
    sock.on("open", () => {
      opened = true;
      ctx.emit("open", {
        url: url.toString(),
        protocol: sock.protocol || "",
        status: upgrade?.statusCode ?? 101,
        headers: Object.entries(upgrade?.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })),
      });
      resolve(driver);
    });
    sock.on("message", (d, isBinary) => {
      const buf = Array.isArray(d) ? Buffer.concat(d) : Buffer.from(d);
      const shown = show(buf);
      ctx.emit("message", { direction: "in", ...shown, frame: isBinary ? "binary" : "text" });
    });
    sock.on("ping", (d) => ctx.emit("ping", { direction: "in", ...show(d) })); // `ws` answers with a pong by itself
    sock.on("pong", (d) => ctx.emit("pong", { direction: "in", ...show(d) }));
    sock.on("unexpected-response", (_req, res) => {
      res.resume();
      const e = new Error(`Handshake rejected: ${res.statusCode} ${res.statusMessage ?? ""}`.trim());
      reject(Object.assign(e, { status: res.statusCode, headers: res.headers }));
    });
    sock.on("error", (e) => {
      const reason = e.code === "SSRF_BLOCKED" ? e.message : e.code === "ECONNREFUSED" ? "Connection refused" : e.code === "ENOTFOUND" ? "DNS lookup failed (host not found)" : e.message;
      if (!opened) reject(Object.assign(new Error(reason), { code: e.code }));
      else ctx.emit("error", { message: reason });
    });
    sock.on("close", (code, reason) => {
      if (opened) ctx.finish({ code, reason: reason.toString("utf8") });
    });
  });
}
