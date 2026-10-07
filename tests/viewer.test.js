// View-only members can try modified requests out, but the server never lets them save anything.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, base, target, tbase, seen;
before(() => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  target = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { seen = { m: req.method, u: req.url, h: req.headers, b }; res.setHeader("content-type", "application/json"); res.end("{}"); });
  }).listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
});
after(() => { server.close(); target.close(); });

const call = (token) => async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const signup = async (username) => {
  const r = await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "password123" }) })).json();
  return { id: r.user.id, c: call(r.token) };
};

test("viewer: edited requests run, nothing can be saved", async () => {
  const owner = await signup("own"), viewer = await signup("view");
  const ws = (await owner.c("POST", "/workspaces", { name: "W" })).body.id;
  await owner.c("POST", `/workspaces/${ws}/members`, { user_ids: [viewer.id], role: "viewer" });
  const col = (await owner.c("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
  const saved = { name: "R", method: "GET", url: `${tbase}/saved`, params: [], headers: [], body: { mode: "none" } };
  const rid = (await owner.c("POST", `/workspaces/${ws}/collections/${col}/requests`, saved)).body.id;

  // the viewer changes URL, params, headers, body and a pre-request script, and runs it from their own tab
  const edited = {
    ...saved, method: "POST", url: `${tbase}/tryout`, params: [{ key: "q", value: "1", enabled: true }], headers: [{ key: "X-Try", value: "yes", enabled: true }],
    body: { mode: "json", content: '{"a":2}' }, pre_script: 'pm.request.headers.upsert("X-Script", "ran");',
  };
  const run = await viewer.c("POST", `/workspaces/${ws}/run`, { request: edited, collection_id: col });
  assert.equal(run.status, 200);
  assert.equal(run.body.response.status, 200);
  assert.deepEqual([seen.m, seen.u, seen.h["x-try"], seen.h["x-script"], seen.b], ["POST", "/tryout?q=1", "yes", "ran", '{"a":2}']);

  // …but every way of persisting is refused, and the stored request is untouched
  assert.equal((await viewer.c("PUT", `/workspaces/${ws}/requests/${rid}`, edited)).status, 403);
  assert.equal((await viewer.c("POST", `/workspaces/${ws}/collections/${col}/requests`, edited)).status, 403);
  assert.equal((await viewer.c("DELETE", `/workspaces/${ws}/requests/${rid}`)).status, 403);
  assert.equal((await viewer.c("PATCH", `/workspaces/${ws}/collections/${col}`, { pre_script: "x" })).status, 403);
  const stored = (await owner.c("GET", `/workspaces/${ws}/requests/${rid}`)).body;
  assert.deepEqual([stored.method, stored.url, stored.body.mode, stored.pre_script ?? ""], ["GET", `${tbase}/saved`, "none", ""]);

  // a script run by a viewer can't write environment variables either
  const env = (await owner.c("POST", `/workspaces/${ws}/environments`, { name: "E", variables: [{ key: "k", value: "orig" }] })).body.id;
  await viewer.c("POST", `/workspaces/${ws}/run`, { request: { ...saved, pre_script: 'pm.environment.set("k", "hacked");' }, environment_id: env });
  const envs = (await owner.c("GET", `/workspaces/${ws}/environments`)).body;
  assert.equal(envs.find((e) => e.id === env).variables.find((v) => v.key === "k").value, "orig");
});
