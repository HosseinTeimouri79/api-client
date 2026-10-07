// Server-Sent Events: the stream parser, and streaming through live sessions.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startSseServer } from "./fixtures/sse-server.js";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { SseParser } from "../src/protocols/sse.js";

const parse = (chunks, opts = {}) => {
  const out = [], comments = [];
  const p = new SseParser({ onEvent: (e) => out.push(e), onComment: (c) => comments.push(c), ...opts });
  for (const c of chunks) p.push(c);
  p.end();
  return { out, comments };
};

test("parser: fields, multi-line data, comments, default event name, retry", () => {
  const { out, comments } = parse([": keep-alive\n\nevent: a\nid: 7\ndata: one\n\ndata: x\ndata: y\n\nretry: 500\n\ndata\n\nunknown: field\ndata:nospace\n\n"]);
  assert.deepEqual(comments, ["keep-alive"]);
  assert.deepEqual(out, [
    { event: "a", data: "one", id: "7", retry: null },
    { event: "message", data: "x\ny", id: "7", retry: null },
    { event: null, data: null, id: "7", retry: 500 },
    { event: "message", data: "", id: "7", retry: null },
    { event: "message", data: "nospace", id: "7", retry: null },
  ]);
});

test("parser: any line ending, chunk boundaries anywhere, BOM, ids with NUL ignored", () => {
  const text = "﻿id: 1\r\ndata: a\r\n\r\ndata: b\rdata: c\r\rid: bad\0id\ndata: d\n\n";
  const whole = parse([text]).out;
  assert.deepEqual(whole.map((e) => [e.data, e.id]), [["a", "1"], ["b\nc", "1"], ["d", "1"]]);
  for (let cut = 1; cut < text.length; cut++) assert.deepEqual(parse([text.slice(0, cut), text.slice(cut)]).out, whole, `cut at ${cut}`);
  assert.deepEqual(parse([...text]).out, whole, "one character at a time");
  // an unfinished event at the end is dropped; a trailing \r still ends its line
  assert.deepEqual(parse(["data: lost"]).out, []);
  assert.deepEqual(parse(["data: kept\r\r"]).out.map((e) => e.data), ["kept"]);
});

test("parser: limits", () => {
  assert.throws(() => parse(["data: " + "x".repeat(200)], { maxBytes: 100 }), /longer than 100 bytes/);
  assert.throws(() => parse(["data: " + "x".repeat(60) + "\ndata: " + "y".repeat(60) + "\n\n"], { maxBytes: 100 }), /larger than 100 bytes/);
});

let server, base, sse, tok, ws;
before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  sse = await startSseServer();
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json", } , body: JSON.stringify({ username: "sseuser", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(() => { server.close(); sse.stop(); });
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const open = (path, extra = {}, more = {}) =>
  call("POST", `/workspaces/${ws}/sessions`, { request: { protocol: "sse", method: "GET", url: sse.base + path, params: [], headers: [], body: { mode: "none" }, protocol_data: {}, ...extra }, ...more });
async function events(id, until = (e) => e.some((x) => x.type === "closed"), follow = true) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/workspaces/${ws}/sessions/${id}/events${follow ? "" : "?follow=false"}`, { headers: { authorization: `Bearer ${tok}` }, signal: ctl.signal });
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
const msgs = (evs) => evs.filter((e) => e.type === "message").map((e) => [e.event, e.data, e.id]);

test("a stream: events with names and ids, multi-line data, comments, retry, chunked data; the server ending it closes the session", async () => {
  const r = await open("/stream", { headers: [{ key: "X-Test", value: "1" }], auth: { type: "bearer", token: "sse-tok" } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const evs = await events(r.body.id);
  assert.deepEqual(msgs(evs), [
    ["tick", "first", "1"], ["message", "line one\nline two", "1"], ["message", '{"json":true,"n":[1,2]}', "1"], ["message", "after retry", "2"], ["message", "split across chunks", "2"],
  ]);
  assert.deepEqual(evs.filter((e) => e.type === "comment").map((e) => e.text), ["hello comment"]);
  assert.deepEqual(evs.filter((e) => e.type === "retry").map((e) => e.text), ["250 ms"]);
  const open_ = evs.find((e) => e.type === "open");
  assert.equal(open_.status, 200);
  assert.ok(open_.headers.some((h) => h.key === "content-type" && /event-stream/.test(h.value)));
  assert.equal(evs.at(-1).type, "closed");
  assert.match(evs.at(-1).reason, /server ended the stream/);
  const sent = sse.seen.filter((s) => s.path === "/stream").at(-1);
  assert.equal(sent.accept, "text/event-stream");
  assert.equal(sent.auth, "Bearer sse-tok");
  assert.equal(sent.enc, "identity");
});

test("POST with a body (the way many AI and API streams work), params and variables", async () => {
  const r = await open("/echo", { method: "POST", params: [{ key: "q", value: "{{v}}" }], body: { mode: "json", content: '{"prompt":"{{v}}"}' }, variables: [{ key: "v", value: "hi" }] });
  const evs = await events(r.body.id);
  assert.deepEqual(JSON.parse(msgs(evs)[0][1]), { method: "POST", body: '{"prompt":"hi"}' });
  assert.equal(msgs(evs)[0][0], "echo");
  const sent = sse.seen.filter((s) => s.path === "/echo").at(-1);
  assert.deepEqual([sent.ctype, sent.query], ["application/json", "?q=hi"]);
});

test("close stops a stream that never ends", async () => {
  const r = await open("/forever");
  await events(r.body.id, (e) => e.filter((x) => x.type === "message").length >= 3);
  assert.equal((await call("POST", `/workspaces/${ws}/sessions/${r.body.id}/act`, { action: "close" })).status, 200);
  const evs = await events(r.body.id);
  assert.equal(evs.at(-1).type, "closed");
  assert.equal(evs.at(-1).reason, "closed by you");
  assert.equal((await call("POST", `/workspaces/${ws}/sessions/${r.body.id}/act`, { action: "close" })).status, 409);
});

test("reconnect resumes with Last-Event-ID, and gives up after the limit", async () => {
  sse.resetReconnects();
  const a = await open("/resume", { protocol_data: { reconnect: true, maxReconnects: 1 } });
  const evs = await events(a.body.id);
  assert.deepEqual(msgs(evs).map((m) => m[1]), ["first connection", "resumed from 5"]);
  assert.equal(evs.filter((e) => e.type === "open").length, 2);
  assert.ok(evs.some((e) => e.type === "reconnecting" && /Last-Event-ID: 5/.test(e.text)));
  assert.equal(evs.at(-1).reason, "gave up reconnecting");
  assert.equal(sse.seen.filter((s) => s.path === "/resume").at(-1).lastId, "5");
});

test("redirects are followed", async () => {
  const r = await open("/redirect");
  assert.equal(r.body.ok, true);
  assert.equal(msgs(await events(r.body.id))[0][1], "first");
});

test("not an event stream, an error status, an unreachable server, bad method, SSRF", async () => {
  const plain = await open("/plain");
  assert.equal(plain.body.ok, false);
  assert.match(plain.body.error.message, /did not answer with text\/event-stream \(got text\/plain\)/);
  const denied = await open("/denied");
  assert.deepEqual([denied.body.error.status, denied.body.error.body], [401, '{"error":"nope"}']);
  assert.match(denied.body.error.message, /401/);
  assert.match((await open("/x", { url: "http://127.0.0.1:1/x" })).body.error.message, /refused/i);
  assert.equal((await open("/stream", { method: "PUT" })).body.error.phase, "validation");
  config.allowPrivateTargets = false;
  try {
    const r = await open("/stream");
    assert.match(r.body.error.message, /private|internal|SSRF/i);
  } finally { config.allowPrivateTargets = true; }
});

test("an event larger than the response limit stops the stream", async () => {
  const r = await open("/huge", {}, { limits: { maxResponseBytes: 1000 } });
  const evs = await events(r.body.id);
  assert.ok(evs.some((e) => e.type === "error" && /larger than|longer than/.test(e.message)));
  assert.equal(evs.at(-1).type, "closed");
});

test("saved SSE requests keep their settings", async () => {
  const col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "S", protocol: "sse", url: sse.base + "/stream", protocol_data: { reconnect: true } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.protocol_data, { reconnect: true });
});
