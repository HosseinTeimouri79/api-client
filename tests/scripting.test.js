import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import CryptoJS from "crypto-js";
import { runScript } from "../src/services/scriptEngine.js";
import { openDb, migrate } from "../src/db/index.js";
import { migrations } from "../src/db/migrations.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const base = (over = {}) => ({
  variables: {},
  environment: {},
  collectionVariables: {},
  globals: {},
  scope: {},
  request: { url: "http://x/", method: "GET", headers: [], params: [], body: { mode: "none" } },
  ...over,
});

test("pre-request: a real-world Postman checksum script rewrites the body", async () => {
  const code = fs.readFileSync(new URL("./fixtures/postman-checksum.pre.js", import.meta.url), "utf8");
  const r = await runScript(
    code,
    base({
      scope: { api_key: "KEY" },
      request: {
        url: "http://x/",
        method: "POST",
        headers: [],
        params: [],
        body: { mode: "json", content: JSON.stringify({ uid: "u1", params: { a: "t=$timestamp" } }) },
      },
    }),
  );
  assert.equal(r.error, null);
  const out = JSON.parse(r.request.body.content);
  assert.equal(out.uid, "u1");
  assert.match(out.params.a, /^t=\d{4}-\d\d-\d\dT/);
  assert.equal(out.checksum, "{{checksum}}");
  assert.equal(r.globals.checksum, CryptoJS.SHA1(JSON.stringify(out.params) + "KEY").toString());
});
test("pre-request: url/method/headers/params/body mutations", async () => {
  const r = await runScript(
    `pm.request.url = pm.request.url + "a"; pm.request.method = "post";
     pm.request.headers.upsert("X-A","1"); pm.request.headers.add("X-B: 2"); pm.request.headers.upsert("x-a","3");
     pm.request.params.add("q","v w"); pm.request.body.urlencoded.add("k","v");`,
    base(),
  );
  assert.equal(r.error, null);
  assert.equal(r.request.url, "http://x/a");
  assert.equal(r.request.method, "POST");
  assert.deepEqual(r.request.headers.map((h) => [h.key, h.value]), [["X-A", "3"], ["X-B", "2"]]);
  assert.deepEqual(r.request.params.map((h) => [h.key, h.value]), [["q", "v w"]]);
  assert.equal(r.request.body.mode, "urlencoded");
});
test("variables: pm.variables.get falls back to every scope; objects are JSON-stringified", async () => {
  const r = await runScript(
    `console.log(pm.variables.get("k"), pm.variables.replaceIn("{{k}}/{{z}}")); pm.globals.set("o", {a:1}); postman.setGlobalVariable("g", 5);`,
    base({ scope: { k: "K" }, variables: { z: "Z" } }),
  );
  assert.equal(r.logs[0].message, "K K/Z");
  assert.deepEqual(r.globals, { o: '{"a":1}', g: "5" });
});
test("post-request: response can be rewritten for the UI", async () => {
  const r = await runScript(
    `pm.response.setBody({ wrapped: pm.response.json() }); pm.response.setStatus(201, "Created"); pm.response.setHeader("X-Seen","1");
     pm.test("status", () => pm.response.to.have.status(201));`,
    base({ response: { status: 200, statusText: "OK", headers: { "content-type": "text/plain" }, body: '{"a":1}', durationMs: 3 } }),
  );
  assert.equal(r.error, null);
  assert.deepEqual(r.response.changed.sort(), ["body", "headers", "status"]);
  assert.equal(r.response.body, '{"wrapped":{"a":1}}');
  assert.equal(r.response.headers.find((h) => h.key === "Content-Type").value, "application/json");
  assert.deepEqual(r.tests, [{ name: "status", passed: true }]);
});
test("chai-style assertions + helpers", async () => {
  const r = await runScript(
    `pm.test("ok", () => { pm.expect([1,2]).to.have.lengthOf(2); pm.expect({a:[1]}).to.eql({a:[1]}); pm.expect("x").to.be.a("string");
       pm.expect(1).to.not.equal(2); pm.expect(null).to.be.null; pm.expect({a:1}).to.have.property("a"); });
     pm.test("bad", () => pm.expect(1).to.equal(2));
     console.log(btoa("hi"), atob("aGk="), CryptoJS.MD5("a").toString(), require("crypto-js") === CryptoJS);`,
    base(),
  );
  assert.deepEqual(r.tests.map((t) => t.passed), [true, false]);
  assert.equal(r.logs[0].message, "aGk= hi 0cc175b9c0f1b6a831c399e269772661 true");
});
test("sandbox: unknown modules and pm.sendRequest fail with a clear message", async () => {
  const a = await runScript(`require("fs")`, base());
  assert.match(a.error.message, /not available in the sandbox/);
  const b = await runScript(`pm.sendRequest("x")`, base());
  assert.match(b.error.message, /not supported/);
});

// ---- through the real pipeline ----
let server, apiBase, target, tbase, tok, W, seen;
before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  apiBase = `http://127.0.0.1:${server.address().port}/api`;
  target = http
    .createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        seen = { m: req.method, u: req.url, h: req.headers, b };
        res.setHeader("content-type", "application/json");
        res.end('{"n":1}');
      });
    })
    .listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
});
after(() => {
  server.close();
  target.close();
});
const call = async (m, p, b) => {
  const r = await fetch(apiBase + p, {
    method: m,
    headers: { "content-type": "application/json", "x-requested-with": "api-client", ...(tok && { authorization: `Bearer ${tok}` }) },
    body: b && JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
test("pipeline: pre script changes what is sent, post script changes what the UI gets, globals persist", async () => {
  tok = (await call("POST", "/auth/register", { username: "script_user", password: "password123" })).body.token;
  W = `/workspaces/${(await call("POST", "/workspaces", { name: "W" })).body.id}`;
  await call("PATCH", W, { variables: [{ key: "api_key", value: "KEY" }] });
  const note = fs.readFileSync(new URL("./fixtures/postman-checksum.pre.js", import.meta.url), "utf8");
  const run = await call("POST", `${W}/run`, {
    request: {
      method: "POST",
      url: `${tbase}/x`,
      body: { mode: "json", content: JSON.stringify({ uid: "7", params: { t: "$timestamp" } }) },
      pre_script: note,
      post_script: `pm.response.setBody({ original: pm.response.json(), via: "post" }); pm.response.setStatus(202, "Accepted");`,
    },
  });
  assert.equal(run.body.error, null);
  const sent = JSON.parse(seen.b);
  assert.equal(sent.uid, "7");
  assert.match(sent.params.t, /^\d{4}-/);
  assert.equal(sent.checksum, CryptoJS.SHA1(JSON.stringify(sent.params) + "KEY").toString());
  assert.equal(run.body.sent.modified, true);
  assert.equal(run.body.response.status, 202);
  assert.deepEqual(JSON.parse(run.body.response.body), { original: { n: 1 }, via: "post" });
  assert.deepEqual(run.body.response.modifiedByScript.sort(), ["body", "status"]);
  const ws = (await call("GET", W)).body;
  assert.equal(ws.variables.find((v) => v.key === "checksum")?.value, sent.checksum, "global persisted for editors");
});

// ---- username migration ----
test("migration 2: existing email accounts become usernames, data survives", () => {
  // a DB that stops at migration 1, as an existing install would be
  const old = new DatabaseSync(":memory:");
  old.exec("PRAGMA foreign_keys=ON");
  old.exec("CREATE TABLE _migrations(id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT (datetime('now')))");
  old.exec(migrations[0].sql);
  old.prepare("INSERT INTO _migrations(id,name) VALUES(1,'init')").run();
  for (const [id, email] of [["u1", "Ann.Lee@x.io"], ["u2", "ann.lee@y.io"], ["u3", "a@z.io"]])
    old.prepare("INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)").run(id, email, id, "h");
  old.prepare("INSERT INTO workspaces(id,name,owner_id) VALUES('w','W','u1')").run();
  old.prepare("INSERT INTO workspace_members VALUES('w','u1','owner')").run();
  migrate(old);
  assert.deepEqual(
    old.prepare("SELECT id,username FROM users ORDER BY id").all().map((u) => [u.id, u.username]),
    [["u1", "ann.lee"], ["u2", "ann.lee2"], ["u3", "auser"]],
  );
  assert.equal(old.prepare("SELECT COUNT(*) c FROM workspace_members").get().c, 1, "memberships kept");
  assert.equal(old.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.throws(() => old.prepare("INSERT INTO users(id,username,name,password_hash) VALUES('u9','ANN.LEE','x','h')").run(), /UNIQUE/);
});

test("members: candidates picker lists non-members, searchable; bulk add", async () => {
  const mk = async (u) => (await call("POST", "/auth/register", { username: u, name: u.toUpperCase(), password: "password123" })).body.user;
  const [a, b, c] = [await mk("alice"), await mk("bob"), await mk("carol")];
  const all = (await call("GET", `${W}/members/candidates`)).body.map((u) => u.username);
  assert.ok(["alice", "bob", "carol"].every((u) => all.includes(u)));
  assert.ok(!all.includes("script_user"), "current members are not offered");
  assert.deepEqual((await call("GET", `${W}/members/candidates?q=ARO`)).body.map((u) => u.username), ["carol"]);
  assert.equal((await call("POST", `${W}/members`, { user_ids: [a.id, b.id], role: "editor" })).body.added, 2);
  assert.ok(!(await call("GET", `${W}/members/candidates`)).body.some((u) => u.id === a.id));
  assert.equal((await call("POST", `${W}/members`, { username: "CAROL", role: "viewer" })).status, 201);
  assert.equal((await call("POST", `${W}/members`, { user_ids: [c.id], role: "viewer" })).status, 409);
  const m = (await call("GET", `${W}/members`)).body;
  assert.deepEqual(m.map((x) => x.username).sort(), ["alice", "bob", "carol", "script_user"]);
  assert.ok(m.every((x) => !("email" in x)));
});
