// Per-run request limits (timeout, max response size): the user's value applies, capped by the server's ceilings.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, base, target, tbase, tok, ws;
before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  target = http.createServer((req, res) => {
    const big = req.url.startsWith("/big");
    const delay = req.url.startsWith("/slow") ? 600 : 0;
    setTimeout(() => { res.setHeader("content-type", "text/plain"); res.end(big ? "x".repeat(50_000) : "ok"); }, delay);
  }).listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "limits", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(() => { server.close(); target.close(); });
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const run = (limits, path = "/ok") => call("POST", `/workspaces/${ws}/run`, { request: { method: "GET", url: tbase + path, params: [], headers: [], body: { mode: "none" } }, ...(limits && { limits }) });

test("request timeout: the user's value applies, 0 means up to the server ceiling", async () => {
  assert.equal((await run({ timeoutMs: 5000 }, "/slow")).body.response.status, 200);
  const short = await run({ timeoutMs: 100 }, "/slow");
  assert.equal(short.body.response, null);
  assert.match(short.body.error.message, /timeout/i);
  const saved = config.maxRequestTimeoutMs;
  try {
    config.maxRequestTimeoutMs = 0; // no ceiling: 0 really never times out
    assert.equal((await run({ timeoutMs: 0 }, "/slow")).body.response.status, 200);
    config.maxRequestTimeoutMs = 200; // ceiling caps both explicit values and 0
    assert.match((await run({ timeoutMs: 0 }, "/slow")).body.error.message, /timeout/i);
    assert.match((await run({ timeoutMs: 3_000_000 }, "/slow")).body.error.message, /timeout/i);
  } finally { config.maxRequestTimeoutMs = saved; }
});

test("max response size: the user's value applies, 0 means up to the server ceiling", async () => {
  assert.equal((await run({ maxResponseBytes: 100_000 }, "/big")).body.response.size, 50_000);
  assert.match((await run({ maxResponseBytes: 1000 }, "/big")).body.error.message, /exceeds 1000 bytes/);
  assert.equal((await run({ maxResponseBytes: 0 }, "/big")).body.response.size, 50_000);
  const saved = config.maxResponseBytesLimit;
  try {
    config.maxResponseBytesLimit = 2000;
    assert.match((await run({ maxResponseBytes: 0 }, "/big")).body.error.message, /exceeds 2000 bytes/);
    assert.match((await run({ maxResponseBytes: 90_000 }, "/big")).body.error.message, /exceeds 2000 bytes/);
  } finally { config.maxResponseBytesLimit = saved; }
  // no limits sent: the server defaults apply
  assert.equal((await run(undefined, "/big")).body.response.size, 50_000);
});
