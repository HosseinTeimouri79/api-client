// AMQP: connect, publish, consume, ack and reject through live sessions, against an in-process AMQP 0-9-1 broker
// (tests/fixtures/amqp-broker.js, built on amqplib's own frame codec).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import amqp from "amqplib";
import { startAmqpBroker } from "./fixtures/amqp-broker.js";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, app, base, b, tok, ws, outside, outsideCh;
before(async () => {
  config.allowPrivateTargets = true;
  app = createApp(openDb(":memory:"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  b = await startAmqpBroker();
  outside = await amqp.connect(b.url);
  outsideCh = await outside.createConfirmChannel();
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "amqpuser", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(async () => { app.locals.sessions.closeAll(); server.closeAllConnections(); server.close(); await outside.close().catch(() => {}); b.stop(); });
const call = async (m, p, body) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const open = (url = b.url, data = {}, more = {}) =>
  call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "amqp", method: "GET", url, params: [], headers: [], protocol_data: data, ...more.request }, ...more.rest });
const act = (id, action, payload) => call("POST", `/workspaces/${ws}/sessions/${id}/act`, { action, payload });
const del = (id) => call("DELETE", `/workspaces/${ws}/sessions/${id}`);
async function events(id, until = (e) => e.some((x) => x.type === "closed")) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/workspaces/${ws}/sessions/${id}/events`, { headers: { authorization: `Bearer ${tok}` }, signal: ctl.signal });
  const out = [];
  let buf = "";
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const d = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (d && d.length > 8) out.push(JSON.parse(d.slice(6)));
      }
      if (until(out)) break;
    }
  } catch (e) { if (e.name !== "AbortError") throw e; } finally { clearTimeout(timer); ctl.abort(); }
  return out;
}
const inbound = (evs) => evs.filter((e) => e.type === "message" && e.direction === "in");
const nIn = (n) => (evs) => inbound(evs).length >= n;
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const consume = (id, queue, extra = {}) => act(id, "consume", { queue, declare: { durable: false, exclusive: false, autoDelete: false }, ...extra });

test("connect: broker details, virtual host and credentials from the URL or from settings; refused logins", async () => {
  const a = await open(b.url.replace("amqp://", "amqp://guest:guest@") + "/%2F");
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const evs = await events(a.body.id, (e) => e.some((x) => x.type === "open"));
  const rows = Object.fromEntries(evs.find((e) => e.type === "open").headers.map((h) => [h.key, h.value]));
  assert.deepEqual([rows.Broker, rows["Virtual host"], rows["User name"], rows.Heartbeat], ["MiniBroker 1.0", "/", "guest", "30 s"]);
  await del(a.body.id);
  const v = await open(b.url + "/staging");
  await del(v.body.id);
  assert.ok(b.log.vhosts.includes("staging"));
  const s = await open(b.url, { username: "guest", password: "guest" });
  assert.equal(s.body.ok, true);
  await del(s.body.id);
  const bad = await open(b.url, { username: "guest", password: "nope" });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.error.message, /403|ACCESS[-_ ]REFUSED/i);
  const urlBad = await open(b.url.replace("amqp://", "amqp://x:y@"));
  assert.equal(urlBad.body.ok, false);
});

test("publish through an exchange to a bound queue and consume it: routing key, exchange, properties, headers", async () => {
  const id = (await open()).body.id;
  const q = uniq("orders"), ex = uniq("shop");
  assert.equal((await consume(id, q, { bind: { exchange: ex, routingKey: "order.*", exchangeType: "topic" }, prefetch: 5 })).status, 200);
  assert.equal((await act(id, "publish", { exchange: ex, routingKey: "order.new", payload: '{"id":7}', contentType: "application/json", deliveryMode: 2, correlationId: "c-1", replyTo: "reply", messageId: "m-1", type: "order", headers: '{"tenant":"acme","n":3}' })).status, 200);
  assert.equal((await act(id, "publish", { exchange: ex, routingKey: "billing.x", payload: "not for us" })).status, 200);
  const evs = await events(id, nIn(1));
  const m = inbound(evs)[0];
  assert.deepEqual([m.data, m.topic, m.exchange, m.queue, m.redelivered, m.awaitingAck], ['{"id":7}', "order.new", ex, q, false, true]);
  assert.equal(typeof m.deliveryTag, "number");
  assert.deepEqual([m.props.contentType, m.props.correlationId, m.props.replyTo, m.props.messageId, m.props.type, m.props.deliveryMode, m.props.headers], ["application/json", "c-1", "reply", "m-1", "order", 2, { tenant: "acme", n: 3 }]);
  assert.ok(evs.some((e) => e.type === "queue" && e.text.startsWith(q)));
  assert.ok(evs.some((e) => e.type === "bound" && e.text.includes(ex)));
  assert.ok(evs.some((e) => e.type === "consuming"));
  assert.deepEqual(evs.filter((e) => e.type === "consumers").at(-1).list.map((c) => [c.queue, c.noAck]), [[q, false]]);
  const out = evs.find((e) => e.type === "message" && e.direction === "out");
  assert.deepEqual([out.topic, out.exchange, out.props.deliveryMode], ["order.new", ex, 2]);
  assert.equal(inbound(evs).length, 1, "the billing message did not match the binding");
  await del(id);
});

test("ack removes a delivery; an unknown tag is an error and the connection survives", async () => {
  const id = (await open()).body.id;
  const q = uniq("acks");
  await consume(id, q);
  await act(id, "publish", { routingKey: q, payload: "one" });
  const m = inbound(await events(id, nIn(1)))[0];
  assert.equal((await act(id, "ack", { deliveryTag: m.deliveryTag })).status, 200);
  const evs = await events(id, (e) => e.some((x) => x.type === "acked"));
  assert.ok(evs.some((x) => x.type === "acked" && x.tag === m.deliveryTag));
  const again = await act(id, "ack", { deliveryTag: m.deliveryTag });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /No unacknowledged delivery/);
  assert.equal((await act(id, "publish", { routingKey: q, payload: "two" })).status, 200, "still working");
  await del(id);
});

test("reject: requeue brings the message back marked redelivered; discard drops it", async () => {
  const id = (await open()).body.id;
  const q = uniq("rejects");
  await consume(id, q);
  await act(id, "publish", { routingKey: q, payload: "again" });
  const first = inbound(await events(id, nIn(1)))[0];
  assert.equal((await act(id, "reject", { deliveryTag: first.deliveryTag, requeue: true })).status, 200);
  const evs = await events(id, nIn(2));
  const second = inbound(evs)[1];
  assert.deepEqual([second.data, second.redelivered], ["again", true]);
  assert.ok(evs.some((e) => e.type === "rejected" && /requeued/.test(e.text)));
  assert.equal((await act(id, "reject", { deliveryTag: second.deliveryTag, requeue: false })).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  const all = await events(id, (e) => e.some((x) => x.type === "rejected" && /discarded/.test(x.text)));
  assert.equal(inbound(all).length, 2, "nothing came back after the discard");
  await del(id);
});

test("nack with multiple, prefetch limits unacknowledged deliveries, auto-ack needs no ack", async () => {
  const id = (await open()).body.id;
  const q = uniq("prefetch");
  await consume(id, q, { prefetch: 2 });
  for (const n of [1, 2, 3, 4]) await act(id, "publish", { routingKey: q, payload: `m${n}` });
  let evs = await events(id, nIn(2));
  await new Promise((r) => setTimeout(r, 150));
  evs = await events(id, nIn(2));
  assert.deepEqual(inbound(evs).map((m) => m.data), ["m1", "m2"], "the broker holds back the rest until something is acknowledged");
  const second = inbound(evs)[1];
  assert.equal((await act(id, "ack", { deliveryTag: second.deliveryTag, multiple: true })).status, 200);
  evs = await events(id, nIn(4));
  assert.deepEqual(inbound(evs).map((m) => m.data), ["m1", "m2", "m3", "m4"]);
  assert.equal((await act(id, "nack", { deliveryTag: inbound(evs)[3].deliveryTag, multiple: true, requeue: false })).status, 200);
  assert.ok((await events(id, (e) => e.some((x) => x.type === "rejected"))).some((x) => x.type === "rejected" && /up to/.test(x.text)));
  await del(id);
  const auto = (await open()).body.id;
  const q2 = uniq("auto");
  await consume(auto, q2, { noAck: true });
  await act(auto, "publish", { routingKey: q2, payload: "fire and forget" });
  const m = inbound(await events(auto, nIn(1)))[0];
  assert.equal(m.awaitingAck, false);
  assert.equal((await act(auto, "ack", { deliveryTag: m.deliveryTag })).status, 400);
  await del(auto);
});

test("a message published by another client reaches the consumer; unacknowledged messages return when the session closes", async () => {
  const q = uniq("shared");
  const id = (await open()).body.id;
  await consume(id, q);
  await outsideCh.sendToQueue(q, Buffer.from("from outside"), { contentType: "text/plain" });
  const m = inbound(await events(id, nIn(1)))[0];
  assert.equal(m.data, "from outside");
  await del(id); // never acknowledged
  await new Promise((r) => setTimeout(r, 150));
  const got = await outsideCh.get(q, { noAck: true });
  assert.equal(got.content.toString(), "from outside");
  assert.equal(got.fields.redelivered, true);
});

test("cancel stops deliveries; a server-named queue; mandatory publishes to nowhere are returned", async () => {
  const id = (await open()).body.id;
  const q = uniq("cancel");
  await consume(id, q);
  const tag = (await events(id, (e) => e.some((x) => x.type === "consumers"))).filter((e) => e.type === "consumers").at(-1).list[0].tag;
  assert.equal((await act(id, "cancel", { tag })).status, 200);
  assert.equal((await act(id, "cancel", { tag })).status, 400);
  await act(id, "publish", { routingKey: q, payload: "unheard" });
  await new Promise((r) => setTimeout(r, 100));
  const evs = await events(id, (e) => e.some((x) => x.type === "cancelled"));
  assert.equal(inbound(evs).length, 0);
  assert.deepEqual(evs.filter((e) => e.type === "consumers").at(-1).list, []);
  assert.equal(b.queues.get(q).messages.length, 1, "the message waits in the queue");
  assert.equal((await consume(id, "")).status, 200);
  assert.ok((await events(id, (e) => e.some((x) => x.type === "queue" && /amq\.gen-/.test(x.text)))).length > 0);
  await act(id, "publish", { routingKey: uniq("nowhere"), payload: "lost", mandatory: true });
  const returned = (await events(id, (e) => e.some((x) => x.type === "returned"))).find((e) => e.type === "returned");
  assert.match(returned.text, /NO_ROUTE/);
  assert.equal(returned.data, "lost");
  await del(id);
});

test("broker errors close only the channel: the session carries on with a fresh one", async () => {
  const id = (await open()).body.id;
  const missing = await act(id, "consume", { queue: uniq("missing"), declare: null });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /404|NOT[-_ ]FOUND/i);
  const badExchange = await act(id, "publish", { exchange: uniq("no-such-exchange"), routingKey: "x", payload: "x" });
  assert.equal(badExchange.status, 400);
  const q = uniq("recover");
  assert.equal((await consume(id, q)).status, 200);
  await act(id, "publish", { routingKey: q, payload: "back in business" });
  assert.equal(inbound(await events(id, nIn(1)))[0].data, "back in business");
  await del(id);
});

test("input checks: headers JSON, payload encodings, unknown actions, publish variables", async () => {
  const id = (await open(b.url, {}, { request: { variables: [{ key: "rk", value: uniq("vars") }, { key: "who", value: "me" }] } })).body.id;
  assert.match((await act(id, "publish", { routingKey: "x", payload: "x", headers: "{oops" })).body.error, /Headers is not valid JSON/);
  assert.match((await act(id, "publish", { routingKey: "x", payload: "x", headers: "[1]" })).body.error, /must be a JSON object/);
  assert.equal((await act(id, "publish", { routingKey: "x", payload: "zz", format: "hex" })).status, 400);
  assert.equal((await act(id, "nope")).status, 400);
  assert.match((await act(id, "consume", { queue: "" })).body.error, /Give a queue name/);
  const evs0 = await events(id, (e) => e.some((x) => x.type === "open"));
  assert.ok(evs0.length);
  await consume(id, "{{rk}}");
  await act(id, "publish", { routingKey: "{{rk}}", payload: "hi {{who}}" });
  assert.equal(inbound(await events(id, nIn(1)))[0].data, "hi me");
  await act(id, "publish", { routingKey: "{{rk}}", payload: "ff fe", format: "hex" });
  const bin = inbound(await events(id, nIn(2)))[1];
  assert.deepEqual([bin.binary, bin.data], [true, Buffer.from([255, 254]).toString("base64")]);
  await del(id);
});

test("disconnect is graceful, closing the session drops the connection, the limit stops a flood", async () => {
  const a = (await open()).body.id;
  await act(a, "disconnect");
  const evs = await events(a);
  assert.equal(evs.at(-1).reason, "closed by you");
  assert.ok(evs.some((e) => e.type === "closing"));
  assert.equal((await act(a, "publish", { routingKey: "x", payload: "late" })).status, 409);
  const f = (await open(b.url, {}, { rest: { limits: { maxResponseBytes: 100 } } })).body.id;
  const q = uniq("flood");
  await consume(f, q);
  await act(f, "publish", { routingKey: q, payload: "x".repeat(500) });
  const flood = await events(f);
  assert.ok(flood.some((e) => e.type === "error" && /more than the response limit/.test(e.message)));
});

test("errors: unreachable broker, bad scheme, SSRF; saved requests keep their settings", async () => {
  assert.match((await open("amqp://127.0.0.1:1")).body.error.message, /refused/i);
  assert.match((await open("http://x")).body.error.message, /Unsupported scheme/);
  config.allowPrivateTargets = false;
  try {
    for (const url of [b.url, b.url.replace("127.0.0.1", "localhost")]) {
      const r = await open(url);
      assert.equal(r.body.ok, false, url);
      assert.match(r.body.error.message, /private|internal|SSRF/i);
    }
  } finally { config.allowPrivateTargets = true; }
  const col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "A", protocol: "amqp", url: b.url, protocol_data: { exchange: "logs", routingKey: "info", prefetch: 3 } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.protocol_data, { exchange: "logs", routingKey: "info", prefetch: 3 });
});

// Optional: the same flow against a real broker. Run with AMQP_TEST_URL=amqp://guest:guest@localhost:5672 (for example RabbitMQ in Docker).
test("a real broker (AMQP_TEST_URL): declare, publish, consume, ack", { skip: !process.env.AMQP_TEST_URL && "set AMQP_TEST_URL to run against a real broker" }, async () => {
  config.allowPrivateTargets = true;
  const id = (await open(process.env.AMQP_TEST_URL)).body.id;
  const q = uniq("real");
  assert.equal((await consume(id, q, { prefetch: 1 })).status, 200);
  await act(id, "publish", { routingKey: q, payload: "real broker", contentType: "text/plain", deliveryMode: 2 });
  const m = inbound(await events(id, nIn(1)))[0];
  assert.equal(m.data, "real broker");
  assert.equal((await act(id, "ack", { deliveryTag: m.deliveryTag })).status, 200);
  await del(id);
});
