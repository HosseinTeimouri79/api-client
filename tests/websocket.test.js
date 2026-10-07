// WebSocket: connect, send, ping/pong and close through live sessions, with the event stream, caps and SSRF guard.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, base, wss, wsUrl, tok, ws, col, other, otherWs;
const gotByServer = [];
before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  wss = new WebSocketServer({
    port: 0,
    handleProtocols: (set) => (set.has("chat") ? "chat" : false),
    verifyClient: ({ req }, done) => (req.url.startsWith("/denied") ? done(false, 401, "Unauthorized") : done(true)),
  });
  wss.on("connection", (s, req) => {
    gotByServer.push({ url: req.url, auth: req.headers.authorization, custom: req.headers["x-custom"] });
    s.on("message", (d, bin) => {
      gotByServer.push({ bin, len: d.length });
      if (bin) s.send(d, { binary: true });
      else if (String(d) === "bye") s.close(4001, "server says bye");
      else s.send("echo:" + d);
    });
    s.on("ping", (d) => gotByServer.push({ ping: String(d) }));
    s.on("pong", (d) => gotByServer.push({ pong: String(d) }));
    s.send("hello");
  });
  await new Promise((r) => wss.on("listening", r));
  wsUrl = `ws://127.0.0.1:${wss.address().port}`;
  const reg = async (username) => (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "password123" }) })).json()).token;
  tok = await reg("wsuser");
  other = await reg("wsother");
  ws = (await call(tok, "POST", "/workspaces", { name: "W" })).body.id;
  col = (await call(tok, "POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  otherWs = (await call(other, "POST", "/workspaces", { name: "O" })).body.id;
});
after(async () => {
  server.close();
  for (const c of wss.clients) c.terminate();
  wss.close();
});
const call = async (t, m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const open = (request, extra = {}) =>
  call(tok, "POST", `/workspaces/${ws}/sessions`, { request: { protocol: "websocket", method: "GET", params: [], headers: [], ...request }, ...extra });
const act = (id, action, payload) => call(tok, "POST", `/workspaces/${ws}/sessions/${id}/act`, { action, payload });
// reads the event stream until `until(events)` is true (or the stream ends)
async function events(id, until, { since = 0, token = tok, follow = true } = {}) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/workspaces/${ws}/sessions/${id}/events?since=${since}${follow ? "" : "&follow=false"}`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const out = [];
  let buf = "";
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const d = block.split("\n").find((l) => l.startsWith("data: "));
        if (d && d.length > 8) out.push(JSON.parse(d.slice(6)));
      }
      if (until(out)) break;
    }
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
  return out;
}
const has = (type, pred = () => true) => (evs) => evs.some((e) => e.type === type && pred(e));

test("connect: handshake details, server greeting, text echo, close", async () => {
  const r = await open({ url: wsUrl + "/chat?room=1", params: [{ key: "q", value: "2" }], headers: [{ key: "X-Custom", value: "yes" }], auth: { type: "bearer", token: "tkn" }, protocol_data: { subprotocols: "nope, chat" } });
  assert.equal(r.status, 201);
  assert.equal(r.body.ok, true);
  assert.equal(gotByServer.at(-1).url, "/chat?room=1&q=2");
  assert.equal(gotByServer.at(-1).auth, "Bearer tkn");
  assert.equal(gotByServer.at(-1).custom, "yes");
  const id = r.body.id;
  assert.equal((await act(id, "send", { data: "hi" })).status, 200);
  const evs = await events(id, has("message", (e) => e.data === "echo:hi"));
  const open_ = evs.find((e) => e.type === "open");
  assert.equal(open_.protocol, "chat");
  assert.equal(open_.status, 101);
  assert.ok(open_.headers.some((h) => h.key === "upgrade"));
  assert.deepEqual(evs.filter((e) => e.type === "message").map((e) => [e.direction, e.data]), [["in", "hello"], ["out", "hi"], ["in", "echo:hi"]]);
  assert.deepEqual(evs.map((e) => e.seq), evs.map((_, i) => i + 1));
  // closing from our side with a code and reason
  assert.equal((await act(id, "close", { code: 4000, reason: "done" })).status, 200);
  const all = await events(id, has("closed"));
  const closed = all.find((e) => e.type === "closed");
  assert.equal(closed.code, 4000);
  assert.equal(closed.reason, "done");
  assert.equal((await act(id, "send", { data: "late" })).status, 409);
});

test("replay: a client that reconnects with ?since= gets only what it missed", async () => {
  const id = (await open({ url: wsUrl })).body.id;
  await act(id, "send", { data: "one" });
  await events(id, has("message", (e) => e.data === "echo:one"));
  const rest = await events(id, () => false, { since: 2, follow: false });
  assert.ok(rest.length > 0);
  assert.ok(rest.every((e) => e.seq > 2));
  await call(tok, "DELETE", `/workspaces/${ws}/sessions/${id}`);
});

test("binary frames (base64 and hex), ping, pong and server-initiated close", async () => {
  const id = (await open({ url: wsUrl })).body.id;
  await act(id, "send", { data: "AAEC/w==", format: "base64" }); // 00 01 02 ff
  await act(id, "send", { data: "de ad be ef", format: "hex" });
  await act(id, "ping", { data: "p1" });
  await act(id, "pong", { data: "p2" });
  assert.equal((await act(id, "send", { data: "not base64!!", format: "base64" })).status, 400);
  assert.equal((await act(id, "send", { data: "abc", format: "hex" })).status, 400);
  assert.equal((await act(id, "ping", { data: "x".repeat(126) })).status, 400);
  await act(id, "send", { data: "bye" });
  const evs = await events(id, has("closed"));
  const msgs = evs.filter((e) => e.type === "message");
  assert.deepEqual(msgs.map((e) => [e.direction, e.binary, e.data]), [
    ["in", false, "hello"], ["out", true, "AAEC/w=="], ["in", true, "AAEC/w=="], ["out", true, "3q2+7w=="], ["in", true, "3q2+7w=="], ["out", false, "bye"],
  ]);
  assert.ok(evs.some((e) => e.type === "pong" && e.direction === "in" && e.data === "p1"), "the server's automatic pong to our ping");
  assert.ok(evs.some((e) => e.type === "ping" && e.direction === "out") && evs.some((e) => e.type === "pong" && e.direction === "out"));
  assert.ok(gotByServer.some((g) => g.ping === undefined && g.pong === "p2"));
  const closed = evs.find((e) => e.type === "closed");
  assert.deepEqual([closed.code, closed.reason], [4001, "server says bye"]);
});

test("variables in the URL, headers and message", async () => {
  const env = (await call(tok, "POST", `/workspaces/${ws}/environments`, { name: "E", variables: [{ key: "who", value: "world" }, { key: "host", value: wsUrl }] })).body;
  const r = await open({ url: "{{host}}/x", headers: [{ key: "X-Custom", value: "{{who}}" }] }, { environment_id: env.id });
  assert.equal(r.body.ok, true);
  assert.equal(gotByServer.at(-1).custom, "world");
  await act(r.body.id, "send", { data: "hello {{who}}" });
  const evs = await events(r.body.id, has("message", (e) => e.direction === "in" && e.data.startsWith("echo:")));
  assert.ok(evs.some((e) => e.data === "echo:hello world"));
  await call(tok, "DELETE", `/workspaces/${ws}/sessions/${r.body.id}`);
});

test("a rejected handshake or an unreachable host is a normal 'ok:false' outcome", async () => {
  const denied = await open({ url: wsUrl + "/denied" });
  assert.equal(denied.status, 200);
  assert.deepEqual([denied.body.ok, denied.body.error.status, denied.body.error.phase], [false, 401, "network"]);
  assert.match(denied.body.error.message, /401/);
  const refused = await open({ url: "ws://127.0.0.1:1" });
  assert.equal(refused.body.ok, false);
  assert.match(refused.body.error.message, /refused/i);
  const bad = await open({ url: "ftp://example.com" });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.error.message, /Unsupported scheme/);
});

test("http(s) URLs are accepted and mapped to ws(s); a bare host defaults to ws", async () => {
  const a = await open({ url: wsUrl.replace("ws://", "http://") });
  assert.equal(a.body.ok, true);
  const b = await open({ url: wsUrl.replace("ws://", "") });
  assert.equal(b.body.ok, true);
  for (const x of [a, b]) await call(tok, "DELETE", `/workspaces/${ws}/sessions/${x.body.id}`);
});

test("sessions belong to their user and workspace; viewers may connect; unknown ids are 404", async () => {
  const id = (await open({ url: wsUrl })).body.id;
  // someone else cannot see, act on or close it, even with a valid workspace of their own
  assert.equal((await call(other, "POST", `/workspaces/${otherWs}/sessions/${id}/act`, { action: "send", payload: { data: "x" } })).status, 404);
  assert.equal((await call(other, "DELETE", `/workspaces/${otherWs}/sessions/${id}`)).status, 404);
  assert.equal((await call(other, "POST", `/workspaces/${ws}/sessions/${id}/act`, { action: "ping" })).status, 404, "not a member of that workspace");
  assert.equal((await call(tok, "GET", `/workspaces/${ws}/sessions`)).body.some((s) => s.id === id), true);
  assert.equal((await call(other, "GET", `/workspaces/${otherWs}/sessions`)).body.length, 0);
  // a viewer in the workspace can run (connect) but sees only their own sessions
  const member = await call(tok, "POST", `/workspaces/${ws}/members`, { username: "wsother", role: "viewer" });
  assert.ok([200, 201].includes(member.status), JSON.stringify(member.body));
  const v = await call(other, "POST", `/workspaces/${ws}/sessions`, { request: { protocol: "websocket", url: wsUrl } });
  assert.equal(v.body.ok, true);
  assert.equal((await call(other, "GET", `/workspaces/${ws}/sessions`)).body.length, 1);
  assert.equal((await call(other, "POST", `/workspaces/${ws}/sessions/${id}/act`, { action: "ping" })).status, 404);
  await call(other, "DELETE", `/workspaces/${ws}/sessions/${v.body.id}`);
  await call(tok, "DELETE", `/workspaces/${ws}/sessions/${id}`);
  assert.equal((await call(tok, "POST", `/workspaces/${ws}/sessions/nope/act`, { action: "ping" })).status, 404);
});

test("limits: too many open connections, protocols without sessions, invalid close codes", async () => {
  const keep = config.maxSessionsPerUser;
  const sm = server.listeners("request")[0]; // the express app
  const sessions = sm.locals.sessions;
  const saved = sessions.perUser;
  sessions.perUser = 2;
  try {
    const ids = [];
    for (let i = 0; i < 2; i++) ids.push((await open({ url: wsUrl })).body.id);
    const third = await open({ url: wsUrl });
    assert.equal(third.status, 429);
    assert.match(third.body.error, /Too many open connections/);
    assert.equal((await act(ids[0], "close", { code: 1005 })).status, 400);
    await call(tok, "DELETE", `/workspaces/${ws}/sessions/${ids[0]}`);
    assert.equal((await open({ url: wsUrl })).body.ok, true, "closing frees a slot");
    for (const id of ids.slice(1)) await call(tok, "DELETE", `/workspaces/${ws}/sessions/${id}`);
  } finally {
    sessions.perUser = saved;
    for (const s of sessions.list((await call(tok, "GET", "/auth/me")).body.user.id, ws)) sessions.close(s);
  }
  assert.equal(keep, config.maxSessionsPerUser);
  assert.equal((await call(tok, "POST", `/workspaces/${ws}/sessions`, { request: { protocol: "http", url: wsUrl } })).status, 400);
});

test("idle sessions are closed by the sweeper, and the event log is capped", async () => {
  const sessions = server.listeners("request")[0].locals.sessions;
  const { idleMs, keep } = sessions;
  const id = (await open({ url: wsUrl })).body.id;
  sessions.keep = 3;
  for (let i = 0; i < 6; i++) await act(id, "send", { data: "m" + i });
  await new Promise((r) => setTimeout(r, 100));
  const tail = await events(id, () => false, { follow: false });
  assert.ok(tail.length <= 3 && tail.at(-1).seq > 6, "only the newest events are kept");
  sessions.keep = keep;
  sessions.idleMs = 1;
  await new Promise((r) => setTimeout(r, 20));
  sessions.sweep();
  sessions.idleMs = idleMs;
  const evs = await events(id, has("closed"));
  assert.match(evs.find((e) => e.type === "closed").reason, /idle/);
});

test("the SSRF guard blocks private targets for WebSocket too", async () => {
  config.allowPrivateTargets = false;
  try {
    const lit = await open({ url: wsUrl });
    assert.equal(lit.body.ok, false);
    assert.match(lit.body.error.message, /private|internal|SSRF/i);
    const name = await open({ url: "ws://localhost:" + wss.address().port });
    assert.equal(name.body.ok, false);
    assert.match(name.body.error.message, /private|internal|SSRF/i);
  } finally {
    config.allowPrivateTargets = true;
  }
});

test("saved requests may now be websocket requests", async () => {
  const made = await call(tok, "POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Socket", protocol: "websocket", url: wsUrl, protocol_data: { subprotocols: "chat" } });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.protocol, made.body.protocol_data], ["websocket", { subprotocols: "chat" }]);
  const tree = (await call(tok, "GET", `/workspaces/${ws}/tree`)).body;
  assert.equal(tree.requests.find((r) => r.id === made.body.id).protocol, "websocket");
  const exp = await call(tok, "GET", `/workspaces/${ws}/export?format=postman&collection=${col}`);
  assert.ok(exp.body.warnings.some((w) => /non-HTTP/.test(w)));
  assert.ok(!JSON.stringify(exp.body.data).includes("Socket"));
});
