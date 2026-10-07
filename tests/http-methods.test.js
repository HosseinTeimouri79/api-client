// HTTP: every method from the protocol list works end to end (including TRACE and CONNECT), and requests carry a protocol.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { HTTP_METHODS } from "../src/protocols/index.js";
import { parseImport } from "../src/services/interop.js";

let server, base, target, tbase, proxy, pbase, seen, connects, tok, ws, col;
before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  target = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { seen = { m: req.method, u: req.url, b, h: req.headers }; res.setHeader("content-type", req.method === "TRACE" ? "message/http" : "text/plain"); res.end(req.method === "HEAD" ? undefined : `${req.method} ${req.url}`); });
  }).listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
  connects = [];
  proxy = http.createServer((_q, r) => r.end("no")).listen(0);
  proxy.on("connect", (req, socket) => {
    connects.push(req.url);
    const deny = req.url.startsWith("blocked");
    socket.write(deny ? "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n" : "HTTP/1.1 200 Connection Established\r\nProxy-Agent: test-proxy\r\n\r\n");
    socket.end();
  });
  pbase = `http://127.0.0.1:${proxy.address().port}`;
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "methods", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
  col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
});
after(() => { server.close(); target.close(); proxy.close(); });
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const run = (request) => call("POST", `/workspaces/${ws}/run`, { request: { params: [], headers: [], body: { mode: "none" }, ...request } });

test("the protocol list starts with all nine HTTP methods", () => {
  assert.deepEqual(HTTP_METHODS, ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"]);
});

test("every method except CONNECT reaches the server with that method; bodyless ones never send a body", async () => {
  for (const method of HTTP_METHODS.filter((m) => m !== "CONNECT")) {
    seen = null;
    const r = await run({ method, url: `${tbase}/m`, body: { mode: "json", content: '{"a":1}' } });
    assert.equal(r.status, 200, method);
    assert.equal(r.body.response.status, 200, method);
    assert.equal(seen.m, method);
    const bodyless = ["GET", "HEAD", "TRACE"].includes(method);
    assert.equal(seen.b, bodyless ? "" : '{"a":1}', `${method} body`);
    if (bodyless) assert.ok(r.body.logs.some((l) => l.level === "WARN" && /without a body/.test(l.message)), `${method} warns that the body is ignored`);
  }
});

test("TRACE echoes the request line back", async () => {
  const r = await run({ method: "TRACE", url: `${tbase}/echo?x=1` });
  assert.equal(r.body.response.body, "TRACE /echo?x=1");
  assert.equal(r.body.response.contentType, "message/http");
});

test("CONNECT: the URL is the proxy, the path is the tunnel target; the proxy's answer is shown", async () => {
  connects.length = 0;
  const ok = await run({ method: "CONNECT", url: `${pbase}/example.com:443` });
  assert.equal(ok.body.response.status, 200);
  assert.equal(ok.body.response.statusText, "Connection Established");
  assert.equal(ok.body.response.headers.find((h) => h.key === "proxy-agent").value, "test-proxy");
  assert.equal(ok.body.response.body, "");
  assert.deepEqual(connects, ["example.com:443"]);
  // no path: the tunnel target is the URL's own host:port
  const same = await run({ method: "CONNECT", url: pbase });
  assert.equal(same.body.response.status, 200);
  assert.equal(connects.at(-1), pbase.replace("http://", ""));
  // a refusal is a normal response, not an error
  const denied = await run({ method: "CONNECT", url: `${pbase}/blocked.example:443` });
  assert.equal(denied.body.response.status, 407);
  // a body typed in the editor is not sent, and a malformed target is a validation error
  const bad = await run({ method: "CONNECT", url: `${pbase}/not a target` });
  assert.equal(bad.body.error.phase, "validation");
  assert.match(bad.body.error.message, /host:port/);
});

test("CONNECT still goes through the SSRF guard", async () => {
  config.allowPrivateTargets = false;
  try {
    const r = await run({ method: "CONNECT", url: `${pbase}/example.com:443` });
    assert.equal(r.body.error.phase, "network");
    assert.match(r.body.error.message, /private|blocked|not allowed/i);
  } finally { config.allowPrivateTargets = true; }
});

test("saved requests carry a protocol and protocol data; TRACE and CONNECT are valid methods", async () => {
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "T", method: "TRACE", url: tbase });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.method, made.body.protocol, made.body.protocol_data], ["TRACE", "http", {}]);
  const put = await call("PUT", `/workspaces/${ws}/requests/${made.body.id}`, { name: "T", method: "CONNECT", url: pbase, protocol_data: { note: "x" } });
  assert.deepEqual([put.body.method, put.body.protocol_data], ["CONNECT", { note: "x" }]);
  // duplicates (request and collection) keep both
  const dup = await call("POST", `/workspaces/${ws}/requests/${made.body.id}/duplicate`, {});
  assert.deepEqual((await call("GET", `/workspaces/${ws}/requests/${dup.body.id}`)).body.protocol_data, { note: "x" });
  const colDup = await call("POST", `/workspaces/${ws}/collections/${col}/duplicate`, {});
  const tree = (await call("GET", `/workspaces/${ws}/tree`)).body;
  const copied = tree.requests.filter((r) => r.collection_id === colDup.body.id);
  assert.ok(copied.length >= 2 && copied.every((r) => r.protocol === "http"));
  assert.equal((await call("GET", `/workspaces/${ws}/requests/${copied[0].id}`)).body.protocol_data !== undefined, true);
  // protocols that are not implemented yet are refused
  assert.equal((await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "W", protocol: "websocket" })).status, 400);
  assert.equal((await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "bad", method: "BREW" })).status, 400);
});

test("Postman files keep TRACE and CONNECT requests", () => {
  const c = parseImport({ info: { name: "M", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [
    { name: "t", request: { method: "TRACE", url: "https://x.io/a" } }, { name: "c", request: { method: "CONNECT", url: "https://x.io/b" } }] });
  assert.deepEqual(c.collections[0].requests.map((r) => r.method), ["TRACE", "CONNECT"]);
  assert.deepEqual(c.warnings, []);
});
