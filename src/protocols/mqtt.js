import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { MqttClient } from "mqtt";
import { createWebSocketStream } from "ws";
import { z } from "zod";
import { safeLookup } from "../services/ssrf.js";
import { effectiveLimits } from "../services/executor.js";
import { config } from "../config.js";
import { resolve as resolveVars } from "../services/variables.js";
import { newSocket } from "./websocket.js";
import { parseEndpoint, decodePayload, describePayload } from "./common.js";

const Qos = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const MqttData = z.object({
  clientId: z.string().max(200).default(""), // empty: a random one
  username: z.string().max(500).default(""),
  password: z.string().max(5000).default(""),
  protocolVersion: z.union([z.literal(3), z.literal(4), z.literal(5)]).default(4), // 3 = MQTT 3.1, 4 = 3.1.1, 5 = 5.0
  keepalive: z.number().int().min(0).max(3600).default(60),
  clean: z.boolean().default(true),
  tlsInsecure: z.boolean().default(false),
  willTopic: z.string().max(500).default(""), // last will: published by the broker if the connection drops without DISCONNECT
  willPayload: z.string().max(100_000).default(""),
  willQos: Qos.default(0),
  willRetain: z.boolean().default(false),
  // drafts kept with the request
  topic: z.string().max(500).default(""),
  payload: z.string().max(1_000_000).default(""),
  payloadFormat: z.enum(["text", "base64", "hex"]).default("text"),
  qos: Qos.default(0),
  retain: z.boolean().default(false),
  subTopic: z.string().max(500).default(""),
  subQos: Qos.default(0),
});
const PublishSchema = z.object({
  topic: z.string().max(65535), payload: z.string().max(10_000_000).default(""),
  format: z.enum(["text", "base64", "hex"]).default("text"), qos: Qos.default(0), retain: z.boolean().default(false),
});
const SubSchema = z.object({ topic: z.string().max(65535), qos: Qos.default(0) });
const SCHEMES = { mqtt: "mqtt", mqtts: "mqtts", tcp: "mqtt", tls: "mqtts", ssl: "mqtts", ws: "ws", wss: "wss", http: "ws", https: "wss" };
const DEFAULT_PORT = { mqtt: 1883, mqtts: 8883 };
const fail = (message, extra = {}) => Object.assign(new Error(message), { phase: "validation", ...extra });
const reason = (e) => (e.code === "SSRF_BLOCKED" ? e.message : e.code === "ECONNREFUSED" ? "Connection refused" : e.code === "ENOTFOUND" ? "DNS lookup failed (host not found)" : e.code === "ETIMEDOUT" ? "Connection timeout" : e.errors?.length ? `${e.code ?? "Connection failed"} — ${[...new Set(e.errors.map((x) => x.code ?? x.message))].join("; ")}` : e.message);

/** A topic to publish to: no wildcards, no empty name. */
export function checkTopic(t) {
  if (!t) throw new Error("Give a topic");
  if (/[+#]/.test(t)) throw new Error("A published topic cannot contain the wildcards + or #");
  if (t.includes("\0")) throw new Error("A topic cannot contain a null character");
  return t;
}
/** A topic filter to subscribe to: + replaces one level, # (last, alone in its level) the rest. */
export function checkFilter(t) {
  if (!t) throw new Error("Give a topic filter");
  if (t.includes("\0")) throw new Error("A topic cannot contain a null character");
  const levels = t.split("/");
  levels.forEach((l, i) => {
    if (l.includes("#") && (l !== "#" || i !== levels.length - 1)) throw new Error('The wildcard # must be the last level, on its own (for example "sensors/#")');
    if (l.includes("+") && l !== "+") throw new Error('The wildcard + must take a whole level (for example "sensors/+/temp")');
  });
  return t;
}

/** Connects to an MQTT broker over TCP, TLS or WebSocket. Resolves once the broker accepted the connection. */
export function connectMqtt({ request, data, limits, ctx, vars }) {
  const cfg = MqttData.parse(data ?? {});
  const url = parseEndpoint(request.url, { schemes: SCHEMES, defaultScheme: "mqtt" });
  const scheme = url.protocol.slice(0, -1);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port) || DEFAULT_PORT[scheme];
  const lim = effectiveLimits(limits);
  const clientId = cfg.clientId || `api-client-${crypto.randomBytes(4).toString("hex")}`;
  const subs = new Map(); // topic filter -> granted qos
  if (cfg.willTopic) checkTopic(cfg.willTopic);

  const streamBuilder = () => {
    const base = { host, port, lookup: safeLookup, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: config.connectAttemptTimeoutMs };
    if (scheme === "mqtt") return net.connect(base);
    if (scheme === "mqtts") return tls.connect({ ...base, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !cfg.tlsInsecure });
    const sock = newSocket(url.toString(), ["mqtt"], {}, lim);
    sock.on("unexpected-response", (_q, res) => { res.resume(); stream.destroy(new Error(`WebSocket handshake rejected: ${res.statusCode} ${res.statusMessage ?? ""}`.trim())); });
    const stream = createWebSocketStream(sock);
    return stream;
  };
  const client = new MqttClient(streamBuilder, {
    protocolVersion: cfg.protocolVersion, protocol: scheme, clientId, keepalive: cfg.keepalive, clean: cfg.clean,
    username: cfg.username || undefined, password: cfg.password || undefined,
    reconnectPeriod: 0, connectTimeout: Number.isFinite(lim.timeoutMs) ? lim.timeoutMs : 30_000, resubscribe: false,
    ...(cfg.willTopic && { will: { topic: cfg.willTopic, payload: Buffer.from(resolveVars(cfg.willPayload, vars ?? {})), qos: cfg.willQos, retain: cfg.willRetain } }),
  });

  return new Promise((resolve, reject) => {
    let connected = false, closing = false, received = 0;
    const publishList = () => ctx.emit("subscriptions", { list: [...subs].map(([topic, qos]) => ({ topic, qos })) });
    const promisify = (fn) => new Promise((ok, no) => fn((e, r) => (e ? no(e) : ok(r))));
    const driver = {
      async act(action, p) {
        if (action === "publish") {
          const m = PublishSchema.parse(p);
          const topic = checkTopic(resolveVars(m.topic, vars ?? {}));
          const buf = m.format === "text" ? Buffer.from(resolveVars(m.payload, vars ?? {}), "utf8") : decodePayload(m.payload, m.format);
          await promisify((cb) => client.publish(topic, buf, { qos: m.qos, retain: m.retain }, cb));
          ctx.emit("message", { direction: "out", topic, qos: m.qos, retain: m.retain, ...describePayload(buf) });
        } else if (action === "subscribe") {
          const m = SubSchema.parse(p);
          const topic = checkFilter(resolveVars(m.topic, vars ?? {}));
          const granted = await promisify((cb) => client.subscribe(topic, { qos: m.qos }, cb));
          const g = granted?.[0];
          if (!g || g.qos > 2) throw new Error("The broker refused the subscription");
          subs.set(topic, g.qos);
          ctx.emit("subscribed", { text: `${topic} (QoS ${g.qos})` });
          publishList();
        } else if (action === "unsubscribe") {
          const topic = checkFilter(resolveVars(String(p?.topic ?? ""), vars ?? {}));
          await promisify((cb) => client.unsubscribe(topic, cb));
          subs.delete(topic);
          ctx.emit("unsubscribed", { text: topic });
          publishList();
        } else if (action === "disconnect") {
          closing = true;
          ctx.emit("closing", {});
          client.end(false, {}); // sends DISCONNECT, so the broker does not publish the will
        } else throw new Error(`Unknown action "${action}"`);
        return { ok: true };
      },
      close() {
        closing = true;
        client.end(true); // drop the connection without DISCONNECT (like a crash): the will, if any, is published
      },
    };
    client.on("connect", (connack) => {
      connected = true;
      ctx.emit("open", {
        url: `${scheme}://${url.host}`, status: null,
        headers: [["Client ID", clientId], ["MQTT version", cfg.protocolVersion === 5 ? "5.0" : cfg.protocolVersion === 4 ? "3.1.1" : "3.1"], ["Session present", String(!!connack?.sessionPresent)], ["Keep-alive", `${cfg.keepalive} s`], ["Clean session", String(cfg.clean)], ...(cfg.username ? [["User name", cfg.username]] : []), ...(cfg.willTopic ? [["Last will", `${cfg.willTopic} (QoS ${cfg.willQos}${cfg.willRetain ? ", retained" : ""})`]] : [])].map(([key, value]) => ({ key, value })),
      });
      resolve(driver);
    });
    client.on("message", (topic, payload, packet) => {
      received += payload.length;
      if (received > lim.maxBytes) { ctx.emit("error", { message: `Received more than the response limit (${lim.maxBytes} bytes): connection closed` }); return driver.close(); }
      ctx.emit("message", { direction: "in", topic, qos: packet.qos, retain: !!packet.retain, dup: !!packet.dup, ...describePayload(payload) });
    });
    client.on("disconnect", (packet) => ctx.emit("error", { message: `The broker sent DISCONNECT${packet?.reasonCode ? ` (reason ${packet.reasonCode})` : ""}` }));
    client.on("error", (e) => {
      const msg = reason(e);
      if (!connected) { reject(Object.assign(new Error(msg), { code: e.code })); client.end(true); } else ctx.emit("error", { message: msg });
    });
    client.on("close", () => {
      if (!connected) return reject(new Error("The connection was closed before the broker accepted it"));
      ctx.finish({ reason: closing ? "closed by you" : "the connection was closed", ok: true });
    });
  });
}
