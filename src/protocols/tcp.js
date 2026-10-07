import net from "node:net";
import tls from "node:tls";
import { z } from "zod";
import { safeLookup } from "../services/ssrf.js";
import { effectiveLimits } from "../services/executor.js";
import { config } from "../config.js";
import { resolve as resolveVars } from "../services/variables.js";
import { parseEndpoint, decodePayload, describePayload } from "./common.js";

export const TcpData = z.object({
  message: z.string().max(1_000_000).default(""), // draft of the next message
  messageFormat: z.enum(["text", "base64", "hex"]).default("text"),
  lineEnding: z.enum(["none", "lf", "crlf"]).default("none"), // appended to text messages
  tlsInsecure: z.boolean().default(false), // tls://: do not verify the certificate
  servername: z.string().max(300).default(""), // tls://: SNI / certificate name when it differs from the host
});
const SendSchema = z.object({
  data: z.string().max(10_000_000).default(""),
  format: z.enum(["text", "base64", "hex"]).default("text"),
  lineEnding: z.enum(["none", "lf", "crlf"]).default("none"),
});
const SCHEMES = { tcp: "tcp", tls: "tls", tcps: "tls", ssl: "tls" };
const ENDINGS = { none: "", lf: "\n", crlf: "\r\n" };
const reason = (e) => (e.code === "SSRF_BLOCKED" ? e.message : e.code === "ECONNREFUSED" ? "Connection refused" : e.code === "ENOTFOUND" ? "DNS lookup failed (host not found)" : e.code === "ETIMEDOUT" ? "Connection timeout" : e.errors?.length ? `${e.code ?? "Connection failed"} — ${[...new Set(e.errors.map((x) => x.code ?? x.message))].join("; ")}` : e.message);
const COALESCE_MS = 15; // chunks arriving this close together are shown as one message (TCP splits data arbitrarily)
const COALESCE_MAX = 64 * 1024;

/** Opens a TCP (or TLS) connection. Resolves once connected; later events and messages go to the session log. */
export function connectTcp({ request, data, limits, ctx, vars }) {
  const cfg = TcpData.parse(data ?? {});
  const url = parseEndpoint(request.url, { schemes: SCHEMES, defaultScheme: "tcp", needPort: true });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port);
  const secure = url.protocol === "tls:";
  const lim = effectiveLimits(limits);
  const base = { host, port, lookup: safeLookup, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: config.connectAttemptTimeoutMs };
  const sock = secure
    ? tls.connect({ ...base, servername: cfg.servername || (net.isIP(host) ? undefined : host), rejectUnauthorized: !cfg.tlsInsecure })
    : net.connect(base);

  return new Promise((resolve, reject) => {
    let connected = false, received = 0, pending = [], pendingSize = 0, timer = null, closing = false;
    if (Number.isFinite(lim.timeoutMs)) sock.setTimeout(lim.timeoutMs, () => { if (!connected) sock.destroy(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })); });

    const flush = () => {
      timer = null;
      if (!pending.length) return;
      const buf = Buffer.concat(pending);
      pending = [];
      pendingSize = 0;
      ctx.emit("message", { direction: "in", ...describePayload(buf) });
    };
    const shown = (buf) => describePayload(buf);
    const driver = {
      async act(action, p) {
        if (action === "send") {
          const { data: d, format, lineEnding } = SendSchema.parse(p);
          const buf = format === "text" ? Buffer.from(resolveVars(d, vars ?? {}) + ENDINGS[lineEnding], "utf8") : decodePayload(d, format);
          await new Promise((ok, no) => sock.write(buf, (e) => (e ? no(e) : ok())));
          ctx.emit("message", { direction: "out", ...shown(buf) });
        } else if (action === "close") {
          closing = true;
          ctx.emit("closing", {});
          sock.end(); // our side is done (FIN); the server may still send until it closes too
          setTimeout(() => sock.destroy(), 3000).unref();
        } else throw new Error(`Unknown action "${action}"`);
        return { ok: true };
      },
      close() {
        closing = true;
        sock.destroy();
      },
    };
    const onConnected = () => {
      connected = true;
      sock.setTimeout(0);
      const rows = [["Remote address", `${sock.remoteAddress}:${sock.remotePort}`], ["Local address", `${sock.localAddress}:${sock.localPort}`]];
      if (secure) {
        const c = sock.getPeerCertificate?.();
        rows.push(["TLS version", sock.getProtocol() ?? ""], ["Cipher", sock.getCipher()?.name ?? ""], ["Certificate trusted", sock.authorized ? "yes" : `no (${sock.authorizationError})`]);
        if (c?.subject) rows.push(["Certificate subject", Object.values(c.subject).join(", ")], ["Certificate issuer", Object.values(c.issuer ?? {}).join(", ")], ["Valid from", c.valid_from ?? ""], ["Valid to", c.valid_to ?? ""], ["Fingerprint (SHA-256)", c.fingerprint256 ?? ""]);
      }
      ctx.emit("open", { url: `${secure ? "tls" : "tcp"}://${url.host}`, headers: rows.map(([key, value]) => ({ key, value })), status: null });
      resolve(driver);
    };
    sock.once(secure ? "secureConnect" : "connect", onConnected);
    sock.on("data", (chunk) => {
      received += chunk.length;
      if (received > lim.maxBytes) { ctx.emit("error", { message: `Received more than the response limit (${lim.maxBytes} bytes): connection closed` }); return sock.destroy(); }
      pending.push(chunk);
      pendingSize += chunk.length;
      if (pendingSize >= COALESCE_MAX) { clearTimeout(timer); flush(); }
      else { clearTimeout(timer); timer = setTimeout(flush, COALESCE_MS); }
    });
    sock.on("end", () => { flush(); ctx.emit("end", {}); });
    sock.on("error", (e) => {
      if (!connected) return reject(Object.assign(new Error(reason(e)), { code: e.code }));
      ctx.emit("error", { message: reason(e) });
    });
    sock.on("close", (hadError) => {
      clearTimeout(timer);
      flush();
      if (connected) ctx.finish({ reason: closing ? "closed by you" : hadError ? "the connection failed" : "the server closed the connection", ok: !hadError });
    });
  });
}
