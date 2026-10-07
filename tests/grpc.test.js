// gRPC: unary, server streaming, client streaming and bidirectional calls through live sessions, plus .proto parsing.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PROTO, startEchoServer } from "./fixtures/grpc-echo.js";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, base, echo, gaddr, tok, ws;

before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  echo = await startEchoServer();
  gaddr = echo.addr;
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "grpcuser", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(() => { server.close(); echo?.stop(); });
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const open = (data, request = {}, extra = {}) =>
  call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "grpc", method: "GET", url: `grpc://${gaddr}`, params: [], headers: [], protocol_data: { proto: PROTO, service: "demo.Echo", ...data }, ...request }, ...extra });
const act = (id, action, payload) => call("POST", `/workspaces/${ws}/sessions/${id}/act`, { action, payload });
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
const msgs = (evs) => evs.filter((e) => e.type === "message").map((e) => [e.direction, JSON.parse(e.data)]);
const closed = (evs) => evs.find((e) => e.type === "closed");

test("describe: services, methods, streaming kinds and an example message", async () => {
  const r = await call("POST", `/workspaces/${ws}/grpc/describe`, { proto: PROTO });
  assert.equal(r.body.ok, true);
  const echo = r.body.services.find((s) => s.name === "demo.Echo");
  assert.deepEqual(echo.methods.map((m) => [m.name, m.clientStreaming, m.serverStreaming]), [["Say", false, false], ["Fail", false, false], ["Slow", false, false], ["Count", false, true], ["Collect", true, false], ["Chat", true, true]]);
  assert.deepEqual(echo.methods[0].example, { text: "", n: "0", data: "", color: "RED", at: { seconds: "0", nanos: 0 }, tags: [] });
  assert.equal(echo.methods[0].input, "demo.Msg");
  assert.deepEqual((await call("POST", `/workspaces/${ws}/grpc/describe`, { proto: "" })).body, { ok: true, services: [] });
  const bad = await call("POST", `/workspaces/${ws}/grpc/describe`, { proto: "syntax = 'proto3'; message {" });
  assert.equal(bad.body.ok, false);
  assert.ok(bad.body.error.length > 0);
  const imp = await call("POST", `/workspaces/${ws}/grpc/describe`, { proto: 'syntax = "proto3"; import "other.proto"; message M {}' });
  assert.match(imp.body.error, /not available/);
});

test("unary: request, initial metadata, response and trailers; status OK", async () => {
  const r = await open({ method: "Say", message: '{"text":"{{who}}","n":"41","color":"GREEN","tags":["a"]}' }, { headers: [{ key: "x-trace", value: "abc" }], auth: { type: "bearer", token: "tok1" }, variables: [{ key: "who", value: "grpc" }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const evs = await events(r.body.id);
  assert.deepEqual(evs.map((e) => e.type), ["open", "message", "headers", "message", "trailers", "closed"]);
  const [out, inn] = msgs(evs);
  assert.deepEqual(out[0], "out");
  assert.equal(out[1].text, "grpc");
  assert.equal(inn[1].text, "hi grpc");
  assert.equal(inn[1].n, "42");
  assert.equal(inn[1].color, "GREEN");
  assert.deepEqual(inn[1].tags, ["a"]);
  assert.equal(echo.seenMeta.at(-1)["x-trace"], "abc");
  assert.equal(echo.seenMeta.at(-1).authorization, "Bearer tok1");
  assert.equal(evs.find((e) => e.type === "open").kind, "unary");
  assert.deepEqual(evs.find((e) => e.type === "trailers").headers.find((h) => h.key === "x-trailer").value, "done");
  const c = closed(evs);
  assert.deepEqual([c.code, c.ok], [0, true]);
  assert.match(c.reason, /^OK/);
});

test("a failing call reports the status code and details", async () => {
  const r = await open({ method: "Fail", message: "{}" });
  const c = closed(await events(r.body.id));
  assert.deepEqual([c.code, c.ok], [5, false]);
  assert.match(c.reason, /NOT_FOUND: nope/);
});

test("deadline: DEADLINE_EXCEEDED when the server is slower than the deadline", async () => {
  const r = await open({ method: "Slow", message: "{}", deadlineMs: 200 });
  const c = closed(await events(r.body.id));
  assert.equal(c.code, 4);
  assert.match(c.reason, /DEADLINE_EXCEEDED/);
});

test("server streaming: one request, many responses", async () => {
  const r = await open({ method: "Count", message: '{"n":"3"}' });
  const evs = await events(r.body.id);
  assert.deepEqual(msgs(evs).filter(([d]) => d === "in").map(([, m]) => m.text), ["#1", "#2", "#3"]);
  assert.equal(evs.find((e) => e.type === "open").kind, "server");
  assert.equal(closed(evs).code, 0);
  assert.equal((await act(r.body.id, "send", { data: "{}" })).status, 409, "finished calls take no more input");
});

test("client streaming: send several messages, end the stream, get one response", async () => {
  const r = await open({ method: "Collect" });
  const id = r.body.id;
  for (const t of ["a", "b", "c"]) assert.equal((await act(id, "send", { data: JSON.stringify({ text: t }) })).status, 200);
  assert.equal((await act(id, "send", { data: "{nope" })).status, 400);
  assert.equal((await act(id, "end")).status, 200);
  const evs = await events(id);
  assert.deepEqual(msgs(evs).map(([d, m]) => [d, m.text]), [["out", "a"], ["out", "b"], ["out", "c"], ["in", "a+b+c"]]);
  assert.ok(evs.some((e) => e.type === "ended"));
  assert.equal(closed(evs).code, 0);
});

test("bidirectional: messages flow both ways until we end our side", async () => {
  const id = (await open({ method: "Chat" })).body.id;
  await act(id, "send", { data: '{"text":"one"}' });
  await events(id, (e) => e.some((x) => x.type === "message" && x.direction === "in"));
  await act(id, "send", { data: '{"text":"two"}' });
  await events(id, (e) => e.filter((x) => x.type === "message" && x.direction === "in").length >= 2);
  await act(id, "end");
  const evs = await events(id);
  assert.deepEqual(msgs(evs).filter(([d]) => d === "in").map(([, m]) => m.text), ["echo one", "echo two"]);
  assert.equal(evs.find((e) => e.type === "open").kind, "bidi");
  assert.equal(closed(evs).code, 0);
});

test("cancel ends a streaming call with CANCELLED", async () => {
  const id = (await open({ method: "Chat" })).body.id;
  assert.equal((await act(id, "cancel")).status, 200);
  const c = closed(await events(id));
  assert.equal(c.code, 1);
  assert.match(c.reason, /CANCELLED/);
});

test("clear errors before anything is sent: bad JSON, wrong field type, unknown method, no proto", async () => {
  const cases = [
    [{ method: "Say", message: "{oops" }, /not valid JSON/],
    [{ method: "Say", message: '{"text": 5, "tags": 3}' }, /does not fit Msg/],
    [{ method: "Nope" }, /Method "Nope" is not in demo.Echo/],
    [{ method: "Say", service: "demo.Other" }, /Service "demo.Other" is not in the .proto/],
    [{ method: "", service: "" }, /Choose a service and method/],
    [{ proto: "", method: "Say" }, /Paste the service's .proto first/],
    [{ proto: "message {", method: "Say" }, /Invalid .proto/],
  ];
  for (const [data, re] of cases) {
    const r = await open({ message: "{}", ...data });
    assert.equal(r.body.ok, false, JSON.stringify(data));
    assert.equal(r.body.error.phase, "validation");
    assert.match(r.body.error.message, re);
  }
});

test("unreachable server, bad scheme and the SSRF guard", async () => {
  const dead = await open({ method: "Say", message: "{}" }, { url: "grpc://127.0.0.1:1" });
  assert.equal(dead.body.ok, false);
  assert.equal(dead.body.error.phase, "network");
  assert.match(dead.body.error.message, /refused|reached|timeout/i);
  const bad = await open({ method: "Say", message: "{}" }, { url: "ftp://x.io" });
  assert.match(bad.body.error.message, /Unsupported scheme/);
  config.allowPrivateTargets = false;
  try {
    for (const url of [`grpc://${gaddr}`, `grpc://localhost:${gaddr.split(":")[1]}`]) {
      const r = await open({ method: "Say", message: "{}" }, { url });
      assert.equal(r.body.ok, false, url);
      assert.match(r.body.error.message, /private|internal|SSRF/i);
    }
  } finally { config.allowPrivateTargets = true; }
});

test("http:// and a bare host:port are accepted for plaintext servers", async () => {
  for (const url of [`http://${gaddr}`, gaddr]) {
    const r = await open({ method: "Say", message: '{"text":"x"}' }, { url });
    assert.equal(r.body.ok, true, url);
    assert.equal(closed(await events(r.body.id)).code, 0);
  }
});

test("saved gRPC requests keep their protocol data", async () => {
  const col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "G", protocol: "grpc", url: `grpc://${gaddr}`, protocol_data: { proto: PROTO, service: "demo.Echo", method: "Say" } });
  assert.equal(made.status, 201);
  assert.equal((await call("GET", `/workspaces/${ws}/requests/${made.body.id}`)).body.protocol_data.method, "Say");
});
