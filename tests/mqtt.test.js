// MQTT: connect, publish, subscribe, unsubscribe and disconnect through live sessions, against an in-process broker.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mqtt from "mqtt";
import { startBroker } from "./fixtures/mqtt-broker.js";
import { selfSigned } from "./fixtures/tls.js";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { checkFilter, checkTopic } from "../src/protocols/mqtt.js";

let server, app, base, b, tok, ws, watcher;
const heard = []; // what an independent client subscribed to "#" hears
before(async () => {
  config.allowPrivateTargets = true;
  app = createApp(openDb(":memory:"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  b = await startBroker();
  watcher = await mqtt.connectAsync(b.tcp, { username: "user", password: "pw" });
  watcher.on("message", (topic, payload, p) => heard.push({ topic, text: payload.toString(), qos: p.qos, retain: p.retain }));
  await watcher.subscribeAsync("#", { qos: 2 });
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "mqttuser", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(async () => { app.locals.sessions.closeAll(); server.close(); await watcher.endAsync(true); await b.stop(); });
const call = async (m, p, body) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const open = (url, data = {}, more = {}) =>
  call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "mqtt", method: "GET", url, params: [], headers: [], protocol_data: { username: "user", password: "pw", ...data }, ...more.request }, ...more.rest });
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
const waitFor = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timed out"); };

test("topic checks", () => {
  assert.equal(checkTopic("a/b/c"), "a/b/c");
  for (const bad of ["", "a/+", "a/#", "a\0b"]) assert.throws(() => checkTopic(bad));
  for (const ok of ["a/b", "a/+/c", "#", "+", "a/#", "+/+", "$SYS/#"]) assert.equal(checkFilter(ok), ok);
  for (const bad of ["", "a/#/b", "a#", "a/b+", "a/+x", "#/a"]) assert.throws(() => checkFilter(bad), bad);
});

test("connect: connection details, client id, will configuration shown", async () => {
  const r = await open(b.tcp, { clientId: "my-client", keepalive: 30, willTopic: "wills/mine", willPayload: "gone" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const evs = await events(r.body.id, (e) => e.some((x) => x.type === "open"));
  const rows = Object.fromEntries(evs.find((e) => e.type === "open").headers.map((h) => [h.key, h.value]));
  assert.deepEqual([rows["Client ID"], rows["MQTT version"], rows["Keep-alive"], rows["Session present"], rows["Last will"]], ["my-client", "3.1.1", "30 s", "false", "wills/mine (QoS 0)"]);
  assert.ok(b.seen.clients.includes("my-client"));
  await del(r.body.id);
});

test("subscribe: wildcard topics, qos, retain flag, binary payloads, and the list of subscriptions", async () => {
  const r = await open(b.tcp);
  const id = r.body.id;
  assert.equal((await act(id, "subscribe", { topic: "sensors/+/temp", qos: 1 })).status, 200);
  assert.equal((await act(id, "subscribe", { topic: "alerts/#", qos: 0 })).status, 200);
  watcher.publish("sensors/a/temp", "21.5", { qos: 1 });
  watcher.publish("sensors/a/humidity", "ignored");
  watcher.publish("alerts/fire/zone1", Buffer.from([0, 255, 1]), { qos: 0, retain: false });
  const evs = await events(id, (e) => inbound(e).length >= 2);
  const got = inbound(evs);
  const temp = got.find((e) => e.topic === "sensors/a/temp"), alert = got.find((e) => e.topic === "alerts/fire/zone1"); // arrival order is up to the broker
  assert.deepEqual([temp.data, temp.qos, temp.retain], ["21.5", 1, false]);
  assert.deepEqual([alert.binary, alert.data], [true, Buffer.from([0, 255, 1]).toString("base64")]);
  const last = evs.filter((e) => e.type === "subscriptions").at(-1);
  assert.deepEqual(last.list, [{ topic: "sensors/+/temp", qos: 1 }, { topic: "alerts/#", qos: 0 }]);
  assert.ok(evs.some((e) => e.type === "subscribed" && /sensors\/\+\/temp \(QoS 1\)/.test(e.text)));
  await del(id);
});

test("unsubscribe stops the messages", async () => {
  const id = (await open(b.tcp)).body.id;
  await act(id, "subscribe", { topic: "news/#" });
  watcher.publish("news/1", "before");
  await events(id, (e) => inbound(e).length >= 1);
  assert.equal((await act(id, "unsubscribe", { topic: "news/#" })).status, 200);
  watcher.publish("news/2", "after");
  await new Promise((r) => setTimeout(r, 200));
  const evs = await events(id, (e) => e.some((x) => x.type === "unsubscribed"));
  assert.deepEqual(inbound(evs).map((e) => e.data), ["before"]);
  assert.deepEqual(evs.filter((e) => e.type === "subscriptions").at(-1).list, []);
  await del(id);
});

test("publish: qos 0, 1 and 2, retained messages, text/hex/base64, variables", async () => {
  const id = (await open(b.tcp, {}, { request: { variables: [{ key: "room", value: "kitchen" }] } })).body.id;
  heard.length = 0;
  for (const qos of [0, 1, 2]) assert.equal((await act(id, "publish", { topic: `pub/q${qos}`, payload: `msg ${qos}`, qos })).status, 200);
  assert.equal((await act(id, "publish", { topic: "pub/retained", payload: "keep me", qos: 1, retain: true })).status, 200);
  assert.equal((await act(id, "publish", { topic: "rooms/{{room}}", payload: "light {{room}}" })).status, 200);
  assert.equal((await act(id, "publish", { topic: "pub/hex", payload: "ff fe", format: "hex" })).status, 200);
  assert.equal((await act(id, "publish", { topic: "pub/b64", payload: "AAEC", format: "base64" })).status, 200);
  await waitFor(() => heard.length >= 7);
  const by = Object.fromEntries(heard.map((h) => [h.topic, h]));
  assert.deepEqual([by["pub/q0"].qos, by["pub/q1"].qos, by["pub/q2"].qos], [0, 1, 2]);
  assert.equal(by["rooms/kitchen"].text, "light kitchen");
  assert.equal(by["pub/retained"].text, "keep me");
  const evs = await events(id, (e) => e.filter((x) => x.type === "message" && x.direction === "out").length >= 7);
  const out = evs.filter((e) => e.direction === "out");
  assert.deepEqual([out[0].topic, out[0].qos, out[3].retain, out[5].binary], ["pub/q0", 0, true, true]);
  // a retained message reaches a subscriber that arrives later
  const late = (await open(b.tcp)).body.id;
  await act(late, "subscribe", { topic: "pub/retained" });
  const got = inbound(await events(late, (e) => inbound(e).length >= 1))[0];
  assert.deepEqual([got.data, got.retain], ["keep me", true]);
  await del(late);
  await del(id);
});

test("publish and subscribe refuse bad input before sending", async () => {
  const id = (await open(b.tcp)).body.id;
  assert.equal((await act(id, "publish", { topic: "a/+", payload: "x" })).status, 400);
  assert.equal((await act(id, "publish", { topic: "", payload: "x" })).status, 400);
  assert.equal((await act(id, "publish", { topic: "a", payload: "x", qos: 3 })).status, 400);
  assert.equal((await act(id, "publish", { topic: "a", payload: "zz", format: "hex" })).status, 400);
  assert.match((await act(id, "subscribe", { topic: "a/#/b" })).body.error, /must be the last level/);
  assert.equal((await act(id, "nope")).status, 400);
  await del(id);
});

test("disconnect is graceful (no will); closing the session drops the connection (will published)", async () => {
  heard.length = 0;
  const a = (await open(b.tcp, { willTopic: "wills/a", willPayload: "a died" })).body.id;
  await act(a, "disconnect");
  const evs = await events(a);
  assert.equal(evs.at(-1).reason, "closed by you");
  assert.ok(evs.some((e) => e.type === "closing"));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!heard.some((h) => h.topic === "wills/a"), "no will after DISCONNECT");
  const c = (await open(b.tcp, { willTopic: "wills/c", willPayload: "c died", willRetain: false })).body.id;
  await del(c);
  await waitFor(() => heard.some((h) => h.topic === "wills/c"));
  assert.equal(heard.find((h) => h.topic === "wills/c").text, "c died");
  assert.equal((await act(a, "publish", { topic: "x", payload: "late" })).status, 409);
});

test("a wrong password is refused with the broker's reason; unreachable and bad schemes", async () => {
  const bad = await open(b.tcp, { password: "wrong" });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.error.message, /Not authorized|Bad user name or password|refused/i);
  assert.match((await open("mqtt://127.0.0.1:1")).body.error.message, /refused/i);
  assert.match((await open("ftp://x")).body.error.message, /Unsupported scheme/);
  assert.match((await open(b.tcp, { willTopic: "a/+" })).body.error.message, /wildcards/);
});

test("WebSocket transport (ws://) and bare / aliased addresses", async () => {
  const r = await open(b.ws);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const id = r.body.id;
  await act(id, "subscribe", { topic: "via/ws" });
  watcher.publish("via/ws", "hello over websocket");
  assert.equal(inbound(await events(id, (e) => inbound(e).length >= 1))[0].data, "hello over websocket");
  await del(id);
  const aliased = await open(b.tcp.replace("mqtt://", "tcp://"));
  assert.equal(aliased.body.ok, true);
  await del(aliased.body.id);
  const bare = await open(b.tcp.replace("mqtt://", ""));
  assert.equal(bare.body.ok, true);
  await del(bare.body.id);
});

test("TLS: untrusted certificates are refused unless verification is skipped", { skip: !selfSigned() && "openssl not available" }, async () => {
  assert.match((await open(b.tls)).body.error.message, /self[- ]signed|certificate|unable to verify/i);
  const r = await open(b.tls, { tlsInsecure: true });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  await act(r.body.id, "publish", { topic: "secure/topic", payload: "over tls" });
  await waitFor(() => heard.some((h) => h.topic === "secure/topic"));
  await del(r.body.id);
});

test("MQTT 3.1 and the version shown; the response limit stops a flood", async () => {
  const v3 = await open(b.tcp, { protocolVersion: 3 });
  assert.equal(v3.body.ok, true, JSON.stringify(v3.body));
  const evs = await events(v3.body.id, (e) => e.some((x) => x.type === "open"));
  assert.equal(evs.find((e) => e.type === "open").headers.find((h) => h.key === "MQTT version").value, "3.1");
  await del(v3.body.id);
  const id = (await open(b.tcp, {}, { rest: { limits: { maxResponseBytes: 100 } } })).body.id;
  await act(id, "subscribe", { topic: "flood" });
  watcher.publish("flood", "x".repeat(500));
  const flood = await events(id);
  assert.ok(flood.some((e) => e.type === "error" && /more than the response limit/.test(e.message)));
});

test("the SSRF guard applies, and saved MQTT requests keep their settings", async () => {
  config.allowPrivateTargets = false;
  try {
    for (const url of [b.tcp, b.tcp.replace("127.0.0.1", "localhost")]) {
      const r = await open(url);
      assert.equal(r.body.ok, false, url);
      assert.match(r.body.error.message, /private|internal|SSRF/i);
    }
  } finally { config.allowPrivateTargets = true; }
  const col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "M", protocol: "mqtt", url: b.tcp, protocol_data: { topic: "a/b", qos: 1 } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.protocol_data, { topic: "a/b", qos: 1 });
});
