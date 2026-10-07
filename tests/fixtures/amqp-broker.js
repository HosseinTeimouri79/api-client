// A small in-process AMQP 0-9-1 broker for the tests, built on amqplib's own frame codec: connection and channel handshake,
// exchanges (direct, fanout, topic), queues, bindings, publish (with confirms), consume, ack / nack / reject with requeue,
// prefetch, cancel and mandatory returns. Not a real broker: no persistence, no TLS.
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("amqplib"));
const defs = require(path.join(root, "lib/defs.js"));
const { parseFrame, decodeFrame, makeBodyFrame } = require(path.join(root, "lib/frame.js"));
const PROTOCOL_HEADER = Buffer.from("AMQP\0\0\x09\x01");

const topicMatch = (pattern, key) => new RegExp("^" + pattern.split(".").map((w) => (w === "#" ? ".*" : w === "*" ? "[^.]+" : w.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))).join("\\.") + "$").test(key);

export async function startAmqpBroker({ user = "guest", password = "guest" } = {}) {
  const exchanges = new Map([["", { type: "direct", bindings: [] }]]);
  const queues = new Map(); // name -> { messages: [], consumers: [], props }
  const log = { connections: [], clientProps: [], vhosts: [] };
  let anon = 0;

  const route = (exchange, key) => {
    if (exchange === "") return queues.has(key) ? [key] : [];
    const ex = exchanges.get(exchange);
    if (!ex) return null;
    return [...new Set(ex.bindings.filter((b) => ex.type === "fanout" || (ex.type === "topic" ? topicMatch(b.key, key) : b.key === key)).map((b) => b.queue))].filter((q) => queues.has(q));
  };

  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0), started = false, closed = false;
    const channels = new Map(); // id -> { confirm, seq, prefetch, consumers: Map, unacked: Map, nextTag, pending: {publish, props, size, chunks} }
    const send = (b) => !closed && sock.write(b);
    const method = (ch, id, fields) => send(defs.encodeMethod(id, ch, fields));
    const content = (ch, props, body) => {
      send(defs.encodeProperties(defs.BasicProperties, ch, body.length, props));
      if (body.length) send(makeBodyFrame(ch, body));
    };
    sock.on("error", () => {});
    // A channel goes away (closed, errored or its connection dropped): its consumers stop, and what it had not acknowledged
    // goes back to the queues, like a real broker does. Consumers go first so nothing is handed to the dead channel again.
    const dropChannel = (c) => {
      for (const q of queues.values()) q.consumers = q.consumers.filter((x) => x.channel !== c);
      const back = [...c.unacked.values()];
      c.unacked.clear();
      for (const m of back) requeue(m);
    };
    sock.on("close", () => {
      closed = true;
      for (const c of channels.values()) dropChannel(c);
    });

    const requeue = (m) => { const q = queues.get(m.queue); if (q) { q.messages.unshift({ ...m.msg, redelivered: true }); dispatch(m.queue); } };
    const dispatch = (name) => {
      const q = queues.get(name);
      if (!q) return;
      let progressed = true;
      while (q.messages.length && progressed) {
        progressed = false;
        for (let i = 0; i < q.consumers.length && q.messages.length; i++) {
          const c = q.consumers.shift(); q.consumers.push(c); // round robin
          const ch = c.channel;
          if (!c.noAck && ch.prefetch && ch.unacked.size >= ch.prefetch) continue;
          const msg = q.messages.shift();
          const tag = ch.nextTag++;
          if (!c.noAck) ch.unacked.set(tag, { queue: name, msg });
          c.method(c.id, defs.BasicDeliver, { consumerTag: c.tag, deliveryTag: tag, redelivered: !!msg.redelivered, exchange: msg.exchange, routingKey: msg.routingKey });
          c.content(c.id, msg.props, msg.body);
          progressed = true;
        }
      }
    };

    const handle = (frame) => {
      const f = decodeFrame(frame);
      if (!f) return;
      if (f.fields === undefined && f.content === undefined) return; // heartbeat
      const ch = f.channel;
      if (f.content !== undefined) { // body frame
        const c = channels.get(ch); const p = c?.pending;
        if (!p) return;
        p.chunks.push(f.content);
        if (p.chunks.reduce((n, x) => n + x.length, 0) >= p.size) finishPublish(ch, c);
        return;
      }
      if (f.size !== undefined) { // header frame
        const c = channels.get(ch);
        if (!c?.pending) return;
        c.pending.props = f.fields; c.pending.size = f.size;
        if (f.size === 0) finishPublish(ch, c);
        return;
      }
      const id = f.id, a = f.fields;
      const c = channels.get(ch);
      const channelError = (code, text) => { method(ch, defs.ChannelClose, { replyCode: code, replyText: text, classId: 0, methodId: 0 }); if (c) dropChannel(c); channels.delete(ch); };
      switch (id) {
        case defs.ConnectionStartOk: {
          const [, u, p] = String(a.response).split("\0");
          log.clientProps.push(a.clientProperties);
          if (u !== user || p !== password) { method(0, defs.ConnectionClose, { replyCode: 403, replyText: "ACCESS_REFUSED - Login was refused using authentication mechanism PLAIN", classId: 0, methodId: 0 }); break; }
          method(0, defs.ConnectionTune, { channelMax: 0, frameMax: 131072, heartbeat: 0 });
          break;
        }
        case defs.ConnectionTuneOk: break;
        case defs.ConnectionOpen: log.vhosts.push(a.virtualHost); method(0, defs.ConnectionOpenOk, { knownHosts: "" }); break;
        case defs.ConnectionClose: method(0, defs.ConnectionCloseOk, {}); sock.end(); break;
        case defs.ConnectionCloseOk: sock.end(); break;
        case defs.ChannelOpen: channels.set(ch, { confirm: false, seq: 0, prefetch: 0, consumers: new Map(), unacked: new Map(), nextTag: 1, pending: null }); method(ch, defs.ChannelOpenOk, { channelId: Buffer.from("") }); break;
        case defs.ChannelClose: { if (c) dropChannel(c); channels.delete(ch); method(ch, defs.ChannelCloseOk, {}); break; }
        case defs.ChannelCloseOk: channels.delete(ch); break;
        case defs.ConfirmSelect: c.confirm = true; method(ch, defs.ConfirmSelectOk, {}); break;
        case defs.ExchangeDeclare: {
          const ex = exchanges.get(a.exchange);
          if (a.passive) { if (!ex) return channelError(404, `NOT_FOUND - no exchange '${a.exchange}' in vhost '/'`); }
          else if (ex && ex.type !== a.type) return channelError(406, `PRECONDITION_FAILED - inequivalent arg 'type' for exchange '${a.exchange}'`);
          else if (!ex) exchanges.set(a.exchange, { type: a.type, bindings: [] });
          method(ch, defs.ExchangeDeclareOk, {});
          break;
        }
        case defs.QueueDeclare: {
          let name = a.queue || `amq.gen-${++anon}`;
          if (a.passive && !queues.has(name)) return channelError(404, `NOT_FOUND - no queue '${name}' in vhost '/'`);
          if (!queues.has(name)) queues.set(name, { messages: [], consumers: [], props: { durable: a.durable, exclusive: a.exclusive, autoDelete: a.autoDelete } });
          const q = queues.get(name);
          method(ch, defs.QueueDeclareOk, { queue: name, messageCount: q.messages.length, consumerCount: q.consumers.length });
          break;
        }
        case defs.QueueBind: {
          if (!queues.has(a.queue)) return channelError(404, `NOT_FOUND - no queue '${a.queue}' in vhost '/'`);
          const ex = exchanges.get(a.exchange);
          if (!ex) return channelError(404, `NOT_FOUND - no exchange '${a.exchange}' in vhost '/'`);
          ex.bindings.push({ queue: a.queue, key: a.routingKey });
          method(ch, defs.QueueBindOk, {});
          break;
        }
        case defs.QueuePurge: { const q = queues.get(a.queue); const n = q?.messages.length ?? 0; if (q) q.messages = []; method(ch, defs.QueuePurgeOk, { messageCount: n }); break; }
        case defs.QueueDelete: { const q = queues.get(a.queue); queues.delete(a.queue); method(ch, defs.QueueDeleteOk, { messageCount: q?.messages.length ?? 0 }); break; }
        case defs.BasicQos: c.prefetch = a.prefetchCount; method(ch, defs.BasicQosOk, {}); for (const n of queues.keys()) dispatch(n); break;
        case defs.BasicConsume: {
          const q = queues.get(a.queue);
          if (!q) return channelError(404, `NOT_FOUND - no queue '${a.queue}' in vhost '/'`);
          const tag = a.consumerTag || `amq.ctag-${++anon}`;
          const consumer = { tag, id: ch, channel: c, noAck: a.noAck, sock, method, content }; // answer on the consumer's own connection
          q.consumers.push(consumer);
          c.consumers.set(tag, a.queue);
          method(ch, defs.BasicConsumeOk, { consumerTag: tag });
          dispatch(a.queue);
          break;
        }
        case defs.BasicCancel: { const qn = c.consumers.get(a.consumerTag); const q = queues.get(qn); if (q) q.consumers = q.consumers.filter((x) => x.tag !== a.consumerTag); c.consumers.delete(a.consumerTag); method(ch, defs.BasicCancelOk, { consumerTag: a.consumerTag }); break; }
        case defs.BasicGet: {
          const q = queues.get(a.queue);
          if (!q) return channelError(404, `NOT_FOUND - no queue '${a.queue}' in vhost '/'`);
          const msg = q.messages.shift();
          if (!msg) { method(ch, defs.BasicGetEmpty, { clusterId: "" }); break; }
          const tag = c.nextTag++;
          if (!a.noAck) c.unacked.set(tag, { queue: a.queue, msg });
          method(ch, defs.BasicGetOk, { deliveryTag: tag, redelivered: !!msg.redelivered, exchange: msg.exchange, routingKey: msg.routingKey, messageCount: q.messages.length });
          content(ch, msg.props, msg.body);
          break;
        }
        case defs.BasicPublish: c.pending = { publish: a, chunks: [], props: {}, size: 0 }; break;
        case defs.BasicAck: {
          const tags = a.multiple ? [...c.unacked.keys()].filter((t) => t <= a.deliveryTag) : [a.deliveryTag];
          if (!a.multiple && !c.unacked.has(a.deliveryTag)) return channelError(406, `PRECONDITION_FAILED - unknown delivery tag ${a.deliveryTag}`);
          for (const t of tags) c.unacked.delete(t);
          for (const n of queues.keys()) dispatch(n);
          break;
        }
        case defs.BasicReject: case defs.BasicNack: {
          const rq = a.requeue;
          const tags = id === defs.BasicNack && a.multiple ? [...c.unacked.keys()].filter((t) => t <= a.deliveryTag) : [a.deliveryTag];
          if (!tags.every((t) => c.unacked.has(t))) return channelError(406, `PRECONDITION_FAILED - unknown delivery tag ${a.deliveryTag}`);
          for (const t of tags) { const m = c.unacked.get(t); c.unacked.delete(t); if (rq) requeue(m); }
          break;
        }
        default: break;
      }
    };
    const finishPublish = (ch, c) => {
      const { publish: p, props, chunks } = c.pending;
      c.pending = null;
      const body = Buffer.concat(chunks);
      const targets = route(p.exchange, p.routingKey);
      if (targets === null) { method(ch, defs.ChannelClose, { replyCode: 404, replyText: `NOT_FOUND - no exchange '${p.exchange}' in vhost '/'`, classId: 60, methodId: 40 }); dropChannel(c); channels.delete(ch); return; }
      if (!targets.length && p.mandatory) { method(ch, defs.BasicReturn, { replyCode: 312, replyText: "NO_ROUTE", exchange: p.exchange, routingKey: p.routingKey }); content(ch, props, body); }
      for (const name of targets) { queues.get(name).messages.push({ exchange: p.exchange, routingKey: p.routingKey, props, body }); dispatch(name); }
      if (c.confirm) method(ch, defs.BasicAck, { deliveryTag: ++c.seq, multiple: false });
    };

    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!started) {
        if (buf.length < 8) return;
        if (!buf.subarray(0, 8).equals(PROTOCOL_HEADER)) { sock.end(PROTOCOL_HEADER); return; }
        buf = buf.subarray(8);
        started = true;
        log.connections.push(sock.remotePort);
        method(0, defs.ConnectionStart, { versionMajor: 0, versionMinor: 9, serverProperties: { product: "MiniBroker", version: "1.0", capabilities: { publisher_confirms: true, 'basic.nack': true, consumer_cancel_notify: true } }, mechanisms: Buffer.from("PLAIN"), locales: Buffer.from("en_US") });
      }
      for (;;) {
        const fr = parseFrame(buf);
        if (!fr) break;
        buf = fr.rest;
        try { handle(fr); } catch (e) { console.error("mini broker:", e); sock.destroy(); }
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `amqp://127.0.0.1:${server.address().port}`, host: "127.0.0.1", port: server.address().port, queues, exchanges, log,
    stop: () => { server.closeAllConnections?.(); server.close(); },
  };
}
