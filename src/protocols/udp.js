import dgram from "node:dgram";
import net from "node:net";
import { z } from "zod";
import { resolvePublicAddress } from "../services/ssrf.js";
import { effectiveLimits } from "../services/executor.js";
import { config } from "../config.js";
import { resolve as resolveVars } from "../services/variables.js";
import { parseEndpoint, decodePayload, describePayload } from "./common.js";

export const UdpData = z.object({
  message: z.string().max(65_000).default(""), // draft of the next datagram
  messageFormat: z.enum(["text", "base64", "hex"]).default("text"),
  lineEnding: z.enum(["none", "lf", "crlf"]).default("none"),
  mode: z.enum(["client", "listen"]).default("client"), // client: send to the URL and read answers; listen: bind a local port
  bindPort: z.number().int().min(0).max(65535).default(0), // listen mode: must be one of the ports the administrator allows
  onlyFromTarget: z.boolean().default(true), // client mode: ignore datagrams that do not come from the target
});
const SendSchema = z.object({
  data: z.string().max(200_000).default(""),
  format: z.enum(["text", "base64", "hex"]).default("text"),
  lineEnding: z.enum(["none", "lf", "crlf"]).default("none"),
});
const ENDINGS = { none: "", lf: "\n", crlf: "\r\n" };
const MAX_DATAGRAM = 65507;
export const portAllowed = (port) => config.udpListenPorts.some(([a, b]) => port >= a && port <= b);
const peer = (r) => `${r.family === "IPv6" ? `[${r.address}]` : r.address}:${r.port}`;
const fail = (message, extra = {}) => Object.assign(new Error(message), { phase: "validation", ...extra });

/** Opens a UDP socket: a client that sends to the URL and shows what comes back, or a listener on an allowed local port. */
export async function connectUdp({ request, data, limits, ctx, vars }) {
  const cfg = UdpData.parse(data ?? {});
  const listen = cfg.mode === "listen";
  const raw = String(request.url ?? "").trim();
  let target = null; // { address, family, port, label }
  if (!listen || raw) {
    const url = parseEndpoint(raw, { schemes: { udp: "udp" }, defaultScheme: "udp", needPort: true });
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addr = await resolvePublicAddress(host); // sends go to the address that was checked
    target = { address: addr.address, family: addr.family, port: Number(url.port), label: `${url.host}` };
  }
  if (listen) {
    if (!config.udpListenPorts.length) throw fail("Listening for UDP is turned off on this server (the administrator can allow ports with UDP_LISTEN_PORTS)");
    if (!cfg.bindPort || !portAllowed(cfg.bindPort)) throw fail(`Port ${cfg.bindPort || "(none)"} is not allowed for listening; allowed: ${config.udpListenPorts.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(", ")}`);
  }
  const lim = effectiveLimits(limits);
  const sock = dgram.createSocket({ type: listen ? "udp4" : target.family === 6 ? "udp6" : "udp4" });
  let received = 0, closing = false;

  await new Promise((ok, no) => {
    sock.once("error", no);
    sock.bind(listen ? cfg.bindPort : 0, () => { sock.off("error", no); ok(); });
  }).catch((e) => {
    try { sock.close(); } catch { /* not open */ }
    throw Object.assign(new Error(e.code === "EADDRINUSE" ? `Port ${cfg.bindPort} is already in use` : e.message), { code: e.code });
  });

  sock.on("error", (e) => ctx.emit("error", { message: e.message }));
  sock.on("message", (msg, rinfo) => {
    if (!listen && cfg.onlyFromTarget && (rinfo.address !== target.address || rinfo.port !== target.port)) return ctx.emit("ignored", { text: `datagram from ${peer(rinfo)} (not the target)` });
    received += msg.length;
    if (received > lim.maxBytes) { ctx.emit("error", { message: `Received more than the response limit (${lim.maxBytes} bytes): socket closed` }); return driver.close(); }
    ctx.emit("message", { direction: "in", peer: peer(rinfo), ...describePayload(msg) });
  });
  sock.on("close", () => ctx.finish({ reason: closing ? "closed by you" : "the socket was closed" }));

  const driver = {
    async act(action, p) {
      if (action === "send") {
        if (!target) throw new Error("Set the address to send to in the URL field");
        const { data: d, format, lineEnding } = SendSchema.parse(p);
        const buf = format === "text" ? Buffer.from(resolveVars(d, vars ?? {}) + ENDINGS[lineEnding], "utf8") : decodePayload(d, format);
        if (buf.length > MAX_DATAGRAM) throw new Error(`A UDP datagram holds at most ${MAX_DATAGRAM} bytes (this one has ${buf.length})`);
        await new Promise((ok, no) => sock.send(buf, target.port, target.address, (e) => (e ? no(e) : ok())));
        ctx.emit("message", { direction: "out", peer: `${target.family === 6 ? `[${target.address}]` : target.address}:${target.port}`, ...describePayload(buf) });
      } else if (action === "close") driver.close();
      else throw new Error(`Unknown action "${action}"`);
      return { ok: true };
    },
    close() {
      closing = true;
      try { sock.close(); } catch { /* already closed */ }
    },
  };
  const local = sock.address();
  ctx.emit("open", {
    url: `udp://${target?.label ?? `:${local.port}`}`, status: null,
    headers: [{ key: "Local address", value: `${net.isIPv6(local.address) ? `[${local.address}]` : local.address}:${local.port}` }, ...(target ? [{ key: "Target", value: `${target.address}:${target.port}` }] : []), { key: "Mode", value: cfg.mode }],
  });
  return driver;
}
