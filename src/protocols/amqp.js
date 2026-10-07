import amqp from "amqplib";
import { z } from "zod";
import { safeLookup } from "../services/ssrf.js";
import { effectiveLimits } from "../services/executor.js";
import { config } from "../config.js";
import { resolve as resolveVars } from "../services/variables.js";
import { parseEndpoint, decodePayload, describePayload } from "./common.js";

const Name = z.string().max(255);
export const AmqpData = z.object({
  username: z.string().max(500).default(""), // empty: the user name from the URL, else "guest"
  password: z.string().max(5000).default(""),
  heartbeat: z.number().int().min(0).max(600).default(30),
  tlsInsecure: z.boolean().default(false),
  // publish drafts
  exchange: Name.default(""), routingKey: Name.default(""), payload: z.string().max(1_000_000).default(""),
  payloadFormat: z.enum(["text", "base64", "hex"]).default("text"),
  contentType: z.string().max(200).default(""), deliveryMode: z.union([z.literal(1), z.literal(2)]).default(1),
  correlationId: z.string().max(255).default(""), replyTo: z.string().max(255).default(""), messageId: z.string().max(255).default(""),
  expiration: z.string().max(20).default(""), type: z.string().max(255).default(""), headers: z.string().max(100_000).default(""), mandatory: z.boolean().default(false),
  // consume drafts
  queue: Name.default(""), declareQueue: z.boolean().default(true), durable: z.boolean().default(false), exclusive: z.boolean().default(false), autoDelete: z.boolean().default(false),
  bindExchange: Name.default(""), bindKey: Name.default(""), exchangeType: z.enum(["", "direct", "fanout", "topic", "headers"]).default(""),
  prefetch: z.number().int().min(0).max(10000).default(10), noAck: z.boolean().default(false),
});
const PublishSchema = z.object({
  exchange: Name.default(""), routingKey: Name.default(""), payload: z.string().max(10_000_000).default(""), format: z.enum(["text", "base64", "hex"]).default("text"),
  contentType: z.string().max(200).default(""), deliveryMode: z.union([z.literal(1), z.literal(2)]).default(1), correlationId: z.string().max(255).default(""),
  replyTo: z.string().max(255).default(""), messageId: z.string().max(255).default(""), expiration: z.string().max(20).default(""), type: z.string().max(255).default(""),
  headers: z.string().max(100_000).default(""), mandatory: z.boolean().default(false),
});
const ConsumeSchema = z.object({
  queue: Name.default(""), declare: z.object({ durable: z.boolean().default(false), exclusive: z.boolean().default(false), autoDelete: z.boolean().default(false) }).nullable().default(null),
  bind: z.object({ exchange: Name, routingKey: Name.default(""), exchangeType: z.enum(["", "direct", "fanout", "topic", "headers"]).default("") }).nullable().default(null),
  prefetch: z.number().int().min(0).max(10000).default(0), noAck: z.boolean().default(false),
});
const SCHEMES = { amqp: "amqp", amqps: "amqps", tcp: "amqp", tls: "amqps", ssl: "amqps" };
const reason = (e) => (e.code === "SSRF_BLOCKED" ? e.message : e.code === "ECONNREFUSED" ? "Connection refused" : e.code === "ENOTFOUND" ? "DNS lookup failed (host not found)" : /ETIMEDOUT/.test(e.message ?? "") ? "Connection timeout" : e.errors?.length ? `${e.code ?? "Connection failed"} — ${[...new Set(e.errors.map((x) => x.code ?? x.message))].join("; ")}` : e.message);
const fail = (message) => Object.assign(new Error(message), { phase: "validation" });
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));
const jsonObject = (text, what) => {
  if (!String(text ?? "").trim()) return undefined;
  let v;
  try { v = JSON.parse(text); } catch (e) { throw new Error(`${what} is not valid JSON: ${e.message}`); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} must be a JSON object`);
  return v;
};
const plain = (v) => JSON.parse(JSON.stringify(v ?? {}, (_k, x) => (typeof x === "bigint" ? String(x) : Buffer.isBuffer(x) ? x.toString("base64") : x)));

/** Connects to an AMQP 0-9-1 broker (RabbitMQ and others). Resolves once the connection and a channel are open. */
export async function connectAmqp({ request, data, limits, ctx, vars }) {
  const cfg = AmqpData.parse(data ?? {});
  const url = parseEndpoint(request.url, { schemes: SCHEMES, defaultScheme: "amqp" });
  const scheme = url.protocol.slice(0, -1);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port) || (scheme === "amqps" ? 5671 : 5672);
  const username = cfg.username || decodeURIComponent(url.username) || "guest";
  const password = cfg.password || (cfg.username || url.username ? decodeURIComponent(url.password) : "guest");
  const vhost = url.pathname.replace(/^\//, ""); // still percent-encoded: "%2F" is the vhost "/"
  const lim = effectiveLimits(limits);

  let conn;
  try {
    conn = await amqp.connect(
      { protocol: scheme, hostname: host, port, username, password, vhost: vhost || undefined, heartbeat: cfg.heartbeat },
      { lookup: safeLookup, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: config.connectAttemptTimeoutMs, ...(scheme === "amqps" && { rejectUnauthorized: !cfg.tlsInsecure }), ...(Number.isFinite(lim.timeoutMs) && { timeout: lim.timeoutMs }) },
    );
  } catch (e) {
    throw Object.assign(new Error(reason(e)), { code: e.code });
  }
  let closing = false, received = 0, ch = null, chOpen = false;
  const pending = new Map(); // deliveryTag -> message waiting for ack / reject
  const consumers = new Map(); // consumerTag -> { queue, noAck }
  const publishList = () => ctx.emit("consumers", { list: [...consumers].map(([tag, c]) => ({ tag, queue: c.queue, noAck: c.noAck })) });

  const attach = (c) => {
    c.on("error", (e) => ctx.emit("error", { message: `The broker closed the channel: ${e.message}` }));
    c.on("close", () => { if (c !== ch) return; chOpen = false; pending.clear(); if (consumers.size) { consumers.clear(); publishList(); } });
    c.on("return", (m) => ctx.emit("returned", { text: `no queue for "${m.fields.routingKey}" on exchange "${m.fields.exchange}" (${m.fields.replyText})`, ...describePayload(m.content) }));
  };
  const channel = async () => {
    if (ch && chOpen) return ch;
    ch = await conn.createConfirmChannel();
    chOpen = true;
    attach(ch);
    return ch;
  };
  await channel();

  const onMessage = (queue, noAck) => (msg) => {
    if (msg === null) { // the broker cancelled the consumer (e.g. the queue was deleted)
      ctx.emit("cancelled", { text: `${queue}: cancelled by the broker` });
      for (const [tag, c] of consumers) if (c.queue === queue) consumers.delete(tag);
      return publishList();
    }
    received += msg.content.length;
    if (received > lim.maxBytes) { ctx.emit("error", { message: `Received more than the response limit (${lim.maxBytes} bytes): connection closed` }); return driver.close(); }
    const f = msg.fields;
    if (!noAck) pending.set(f.deliveryTag, msg);
    ctx.emit("message", {
      direction: "in", topic: f.routingKey, exchange: f.exchange, queue, deliveryTag: f.deliveryTag, redelivered: !!f.redelivered, consumerTag: f.consumerTag,
      awaitingAck: !noAck, props: plain(clean(msg.properties)), ...describePayload(msg.content),
    });
  };
  const take = (tag) => { const m = pending.get(Number(tag)); if (!m) throw new Error(`No unacknowledged delivery with tag ${tag}`); return m; };
  const settle = (tag, multiple) => { for (const t of [...pending.keys()]) if (t === Number(tag) || (multiple && t <= Number(tag))) pending.delete(t); };

  const driver = {
    async act(action, p) {
      const c = await channel();
      if (action === "publish") {
        const m = PublishSchema.parse(p);
        const R = (s) => resolveVars(s, vars ?? {});
        const exchange = R(m.exchange), routingKey = R(m.routingKey);
        const buf = m.format === "text" ? Buffer.from(R(m.payload), "utf8") : decodePayload(m.payload, m.format);
        const headers = jsonObject(R(m.headers), "Headers");
        const props = clean({ contentType: R(m.contentType), correlationId: R(m.correlationId), replyTo: R(m.replyTo), messageId: R(m.messageId), expiration: R(m.expiration), type: R(m.type), headers });
        await new Promise((ok, no) => c.publish(exchange, routingKey, buf, { ...props, persistent: m.deliveryMode === 2, mandatory: m.mandatory }, (e) => (e ? no(e) : ok())));
        ctx.emit("message", { direction: "out", topic: routingKey, exchange, props: plain({ ...props, deliveryMode: m.deliveryMode }), ...describePayload(buf) });
      } else if (action === "consume") {
        const m = ConsumeSchema.parse(p);
        let queue = resolveVars(m.queue, vars ?? {});
        if (m.declare) {
          const ok = await c.assertQueue(queue, { durable: m.declare.durable, exclusive: m.declare.exclusive || (!queue && true), autoDelete: m.declare.autoDelete });
          queue = ok.queue;
          ctx.emit("queue", { text: `${queue}: ${ok.messageCount} message(s), ${ok.consumerCount} consumer(s)` });
        } else if (!queue) throw new Error("Give a queue name");
        if (m.bind?.exchange) {
          const ex = resolveVars(m.bind.exchange, vars ?? {}), key = resolveVars(m.bind.routingKey, vars ?? {});
          if (m.bind.exchangeType) await c.assertExchange(ex, m.bind.exchangeType, { durable: false });
          await c.bindQueue(queue, ex, key);
          ctx.emit("bound", { text: `${queue} ← ${ex}${key ? ` (${key})` : ""}` });
        }
        if (m.prefetch && !m.noAck) await c.prefetch(m.prefetch);
        const { consumerTag } = await c.consume(queue, onMessage(queue, m.noAck), { noAck: m.noAck });
        consumers.set(consumerTag, { queue, noAck: m.noAck });
        ctx.emit("consuming", { text: `${queue}${m.noAck ? " (auto-ack)" : ""}` });
        publishList();
      } else if (action === "ack") {
        const { deliveryTag, multiple } = z.object({ deliveryTag: z.number().int(), multiple: z.boolean().default(false) }).parse(p);
        c.ack(take(deliveryTag), multiple);
        settle(deliveryTag, multiple);
        ctx.emit("acked", { text: `${multiple ? "up to " : ""}#${deliveryTag}`, tag: deliveryTag, multiple });
      } else if (action === "reject" || action === "nack") {
        const { deliveryTag, requeue, multiple } = z.object({ deliveryTag: z.number().int(), requeue: z.boolean().default(false), multiple: z.boolean().default(false) }).parse(p);
        const msg = take(deliveryTag);
        if (action === "nack") c.nack(msg, multiple, requeue); else c.reject(msg, requeue);
        settle(deliveryTag, action === "nack" && multiple);
        ctx.emit("rejected", { text: `${multiple ? "up to " : ""}#${deliveryTag} (${requeue ? "requeued" : "discarded"})`, tag: deliveryTag, requeue });
      } else if (action === "cancel") {
        const { tag } = z.object({ tag: z.string().max(255) }).parse(p);
        if (!consumers.has(tag)) throw new Error(`No consumer "${tag}"`);
        await c.cancel(tag);
        const q = consumers.get(tag).queue;
        consumers.delete(tag);
        ctx.emit("cancelled", { text: q });
        publishList();
      } else if (action === "disconnect") {
        closing = true;
        ctx.emit("closing", {});
        await conn.close().catch(() => {});
      } else throw new Error(`Unknown action "${action}"`);
      return { ok: true };
    },
    close() {
      closing = true;
      conn.close().catch(() => {}); // say goodbye properly; amqplib then stops its heartbeat timers
      setTimeout(() => {
        // a broker that does not answer: cut the socket and let amqplib clean up its timers
        try { conn.connection.stream.destroy(); conn.connection.onSocketError(new Error("connection dropped")); } catch { /* already closed */ }
      }, 1000).unref();
      ctx.finish({ reason: "closed by you", ok: true });
    },
  };

  conn.on("error", (e) => { if (!closing) ctx.emit("error", { message: reason(e) }); });
  conn.on("close", () => ctx.finish({ reason: closing ? "closed by you" : "the connection was closed", ok: true }));
  const sp = conn.connection?.serverProperties ?? {};
  ctx.emit("open", {
    url: `${scheme}://${url.host}`, status: null,
    headers: [["Broker", [sp.product, sp.version].filter(Boolean).join(" ") || "unknown"], ["Virtual host", decodeURIComponent(vhost) || "/"], ["User name", username], ["Heartbeat", `${cfg.heartbeat} s`]].map(([key, value]) => ({ key, value })),
  });
  return driver;
}
