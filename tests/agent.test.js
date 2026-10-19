// Local Agent: its security (Host, Origin/CORS, pairing, tokens, target policy), Local-mode runs through the server's
// pipeline, switching between Server and Local mode, the agent going away, API errors, live sessions, and distribution.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { WebSocketServer } from "ws";
import { openDb } from "../server/db/index.js";
import { createApp } from "../server/app.js";
import { config } from "../server/config.js";
import { agentHome, cli, pairingCode, startAgent } from "./fixtures/agent.js";

let server, base, site, target, targetUrl, agent, home, token, tok, other, ws, envId, wss, wsUrl;
const seen = []; // what the local target received
before(async () => {
  config.allowPrivateTargets = false; // the server cannot reach localhost: only the agent can
  server = createApp(openDb(":memory:")).listen(0);
  site = `http://127.0.0.1:${server.address().port}`;
  base = `${site}/api`;
  target = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url.startsWith("/fail")) return res.writeHead(500, { "content-type": "application/json" }).end('{"error":"boom"}');
      if (req.url.startsWith("/slow")) return setTimeout(() => res.end("late"), 3000);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, path: req.url }));
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => target.once("listening", r));
  targetUrl = `http://127.0.0.1:${target.address().port}`;
  wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (s) => s.on("message", (d) => s.send(`echo:${d}`)));
  await new Promise((r) => wss.on("listening", r));
  wsUrl = `ws://127.0.0.1:${wss.address().port}`;

  const reg = async (username) => (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "password123" }) })).json()).token;
  tok = await reg("localuser");
  other = await reg("localother");
  ws = (await call(tok, "POST", "/workspaces", { name: "W" })).body.id;
  envId = (await call(tok, "POST", `/workspaces/${ws}/environments`, { name: "Local", variables: [{ key: "base", value: targetUrl }] })).body.id;

  home = agentHome();
  agent = await startAgent(home);
  token = await pair(pairingCode(home, site));
});
after(async () => {
  await agent?.stop();
  server.close();
  target.close();
  for (const c of wss.clients) c.terminate();
  wss.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const call = async (t, m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
/** The agent as the browser calls it: from the site's origin, with the paired token. */
const ag = async (m, p, b, { origin = site, auth = token, type = "application/json" } = {}) => {
  const r = await fetch(agent.url + p, { method: m, headers: { ...(type && { "content-type": type }), ...(origin && { origin }), ...(auth && { authorization: `Bearer ${auth}` }) }, body: b && JSON.stringify(b) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
};
async function pair(code, origin = site) {
  const r = await ag("POST", "/v1/pair", { code }, { origin, auth: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}
/** Local mode, as the web app does it: prepare on the server, send with the agent, complete on the server. */
async function runLocal(request, extra = {}, { t = tok, lose = false } = {}) {
  const prep = await call(t, "POST", `/workspaces/${ws}/run/prepare`, { request, environment_id: envId, ...extra });
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  if (prep.body.done) return prep.body.result;
  const sent = lose
    ? { error: { code: "AGENT_UNREACHABLE", message: "The Local Agent is not reachable at http://127.0.0.1:1" } }
    : await ag("POST", "/v1/execute", { request: prep.body.request, limits: prep.body.limits }).then((r) => (r.body.ok ? { response: r.body.response } : { error: r.body.error }));
  const done = await call(t, "POST", `/workspaces/${ws}/run/${prep.body.runId}/complete`, sent);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body;
}
const rawHttp = (port, { host, path = "/v1/health", headers = {} }) =>
  new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers: { host, ...headers } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on("error", reject);
  });

test("the agent answers only to its loopback Host name (DNS rebinding is refused)", async () => {
  for (const host of ["evil.example:" + agent.port, "127.0.0.1.nip.io:" + agent.port, "127.0.0.1:1"]) {
    const r = await rawHttp(agent.port, { host });
    assert.equal(r.status, 421, host);
  }
  for (const host of [`127.0.0.1:${agent.port}`, `localhost:${agent.port}`]) {
    const r = await rawHttp(agent.port, { host });
    assert.equal(r.status, 200, host);
    assert.equal(JSON.parse(r.body).name, "api-client-agent");
  }
});

test("only allowed sites get CORS headers (with Private Network Access); everyone else is refused", async () => {
  const evil = await ag("GET", "/v1/health", null, { origin: "https://evil.example", auth: null });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get("access-control-allow-origin"), null, "no CORS headers for other sites");
  const pre = await fetch(agent.url + "/v1/execute", { method: "OPTIONS", headers: { origin: site, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type", "access-control-request-private-network": "true" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), site);
  assert.equal(pre.headers.get("access-control-allow-private-network"), "true");
  assert.match(pre.headers.get("access-control-allow-headers"), /Authorization/);
  assert.equal(pre.headers.get("access-control-allow-credentials"), null, "no cookies, no credentials mode");
  const evilPre = await fetch(agent.url + "/v1/execute", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
  assert.equal(evilPre.headers.get("access-control-allow-origin"), null);
});

test("without a valid token only health and pairing answer; JSON bodies only (no CSRF through forms)", async () => {
  const health = await ag("GET", "/v1/health", null, { auth: null });
  assert.deepEqual(Object.keys(health.body).sort(), ["name", "paired", "version"], "an unpaired site learns nothing else");
  assert.equal(health.body.paired, false);
  assert.equal((await ag("GET", "/v1/health")).body.paired, true);
  assert.equal((await ag("POST", "/v1/execute", { request: { url: targetUrl, method: "GET" } }, { auth: null })).status, 401);
  assert.equal((await ag("POST", "/v1/execute", { request: { url: targetUrl, method: "GET" } }, { auth: "forged" })).status, 401);
  const form = await fetch(agent.url + "/v1/execute", { method: "POST", headers: { origin: site, authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" }, body: "request=x" });
  assert.equal(form.status, 415);
});

test("pairing: a code works once, five wrong codes cancel it, and a token works only from its own site", async () => {
  const otherSite = "http://localhost:9";
  const code = pairingCode(home, otherSite);
  for (let i = 0; i < 4; i++) assert.equal((await ag("POST", "/v1/pair", { code: "AAAA-AAAA" }, { origin: otherSite, auth: null })).status, 403);
  assert.equal((await ag("POST", "/v1/pair", { code }, { origin: site, auth: null })).status, 403, "a code is for the site it was made for");
  const t2 = await pair(code, otherSite);
  assert.equal((await ag("POST", "/v1/pair", { code }, { origin: otherSite, auth: null })).status, 403, "a code works once");
  assert.equal((await ag("GET", "/v1/sessions", null, { origin: otherSite, auth: t2 })).status, 200);
  assert.equal((await ag("GET", "/v1/sessions", null, { origin: site, auth: t2 })).status, 403, "bound to the site it was paired for");
  const again = pairingCode(home, otherSite);
  for (let i = 0; i < 5; i++) await ag("POST", "/v1/pair", { code: "BBBB-BBBB" }, { origin: otherSite, auth: null });
  const r = await ag("POST", "/v1/pair", { code: again }, { origin: otherSite, auth: null });
  assert.equal(r.status, 403, "five wrong codes cancel the pairing");
  // revoking through the CLI ends the token
  const id = cli(home, "tokens").split("\n").find((l) => l.includes(otherSite)).split(" ")[0];
  assert.match(cli(home, "tokens", "revoke", id), /Revoked 1/);
  assert.equal((await ag("GET", "/v1/sessions", null, { origin: otherSite, auth: t2 })).status, 401);
});

test("Local mode: scripts, variables, tests and history on the server; only the network call on the agent", async () => {
  const request = {
    method: "POST", url: "{{base}}/items?x=1", headers: [{ key: "X-Env", value: "{{base}}" }], body: { mode: "json", content: '{"a":1}' },
    pre_script: 'pm.request.headers.add({ key: "X-Pre", value: "from-script" }); pm.environment.set("token", "abc");',
    post_script: 'pm.test("ok", () => pm.expect(pm.response.json().ok).to.equal(true)); pm.environment.set("seen", String(pm.response.code));',
  };
  // Server mode cannot reach the local target (SSRF protection) ...
  const viaServer = await call(tok, "POST", `/workspaces/${ws}/run`, { request, environment_id: envId });
  assert.equal(viaServer.body.error.phase, "network");
  assert.match(viaServer.body.error.message, /SSRF protection/);
  // ... the agent can, and everything else happens exactly as in Server mode
  seen.length = 0;
  const out = await runLocal(request);
  assert.equal(out.error, null, JSON.stringify(out.error));
  assert.equal(out.response.status, 200);
  assert.deepEqual(JSON.parse(out.response.body), { ok: true, path: "/items?x=1" });
  assert.equal(seen[0].headers["x-pre"], "from-script");
  assert.equal(seen[0].headers["x-env"], targetUrl);
  assert.equal(seen[0].body, '{"a":1}');
  assert.deepEqual(out.tests.map((x) => [x.name, x.passed]), [["ok", true]]);
  assert.ok(out.logs.some((l) => l.message === "Sent through the Local Agent"));
  assert.equal(out.sent.url, `${targetUrl}/items?x=1`);
  const env = (await call(tok, "GET", `/workspaces/${ws}/environments`)).body.find((e) => e.id === envId);
  assert.deepEqual(Object.fromEntries(env.variables.map((v) => [v.key, v.value])), { base: targetUrl, token: "abc", seen: "200" });
  const hist = (await call(tok, "GET", `/workspaces/${ws}/history`)).body;
  assert.equal(hist[0].status, 200);
  assert.equal(hist[0].url, "{{base}}/items?x=1", "history keeps the unresolved request");
});

test("switching between Server and Local mode between runs gives the same kind of result", async () => {
  const request = { method: "GET", url: "{{base}}/same" };
  const local = await runLocal(request);
  config.allowPrivateTargets = true; // a private install where the server can reach the target too
  try {
    const remote = (await call(tok, "POST", `/workspaces/${ws}/run`, { request, environment_id: envId })).body;
    assert.deepEqual(Object.keys(remote).sort(), Object.keys(local).sort());
    assert.equal(remote.response.status, local.response.status);
    assert.equal(remote.response.body, local.response.body);
  } finally {
    config.allowPrivateTargets = false;
  }
  assert.equal((await runLocal(request)).response.status, 200, "and back to Local");
});

test("the agent going away ends the run with a network error; runs belong to their user and complete once", async () => {
  const lost = await runLocal({ method: "GET", url: "{{base}}/x" }, {}, { lose: true });
  assert.equal(lost.error.phase, "network");
  assert.match(lost.error.message, /Local Agent is not reachable/);
  assert.ok(lost.logs.some((l) => l.level === "ERROR" && /Network error/.test(l.message)));
  assert.equal((await call(tok, "GET", `/workspaces/${ws}/history`)).body[0].status, null, "recorded in history like any failed run");

  const prep = (await call(tok, "POST", `/workspaces/${ws}/run/prepare`, { request: { method: "GET", url: "{{base}}/y" }, environment_id: envId })).body;
  const done = { error: { code: "ECONNREFUSED", message: "connect ECONNREFUSED" } };
  assert.equal((await call(tok, "POST", `/workspaces/${ws}/run/${prep.runId}/complete`, { response: { status: "x" } })).status, 400, "malformed reports are refused");
  assert.equal((await call(other, "POST", `/workspaces/${ws}/run/${prep.runId}/complete`, done)).status, 404, "someone else's workspace");
  const first = await call(tok, "POST", `/workspaces/${ws}/run/${prep.runId}/complete`, done);
  assert.equal(first.status, 200, "a malformed report did not use the run up");
  assert.match(first.body.error.message, /Connection refused/);
  assert.equal((await call(tok, "POST", `/workspaces/${ws}/run/${prep.runId}/complete`, done)).status, 404, "a run completes once");

  // a stopped agent refuses connections; started again, the same pairing still works
  await agent.stop();
  await assert.rejects(fetch(agent.url + "/v1/health"));
  agent = await startAgent(home, { port: agent.port });
  assert.equal((await runLocal({ method: "GET", url: "{{base}}/back" })).response.status, 200);
});

test("API errors through the agent: an error status is a response; refused, timed out and oversized requests are errors", async () => {
  const fail = await runLocal({ method: "GET", url: "{{base}}/fail", post_script: 'pm.test("is 500", () => pm.response.to.have.status(500));' });
  assert.equal(fail.error, null);
  assert.equal(fail.response.status, 500);
  assert.deepEqual(fail.tests.map((x) => x.passed), [true]);

  const closed = http.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => closed.once("listening", r));
  const port = closed.address().port;
  closed.close();
  const refused = await runLocal({ method: "GET", url: `http://127.0.0.1:${port}/` });
  assert.match(refused.error.message, /Reason: Connection refused/);

  const slow = await runLocal({ method: "GET", url: "{{base}}/slow" }, { limits: { timeoutMs: 300 } });
  assert.match(slow.error.message, /Connection timeout/);

  const big = await runLocal({ method: "GET", url: "{{base}}/big" }, { limits: { maxResponseBytes: 5 } });
  assert.match(big.error.message, /exceeds 5 bytes/);

  // the server re-checks the size the browser reports (the browser is not trusted)
  const prep = (await call(tok, "POST", `/workspaces/${ws}/run/prepare`, { request: { method: "GET", url: "{{base}}/" }, environment_id: envId, limits: { maxResponseBytes: 5 } })).body;
  const r = await call(tok, "POST", `/workspaces/${ws}/run/${prep.runId}/complete`, { response: { status: 200, body: "far too long" } });
  assert.match(r.body.error.message, /exceeds 5 bytes/);
});

test("the agent's target rules: link-local / cloud metadata blocked by default, never itself", async () => {
  const meta = await ag("POST", "/v1/execute", { request: { url: "http://169.254.169.254/latest/meta-data", method: "GET", headers: {} } });
  assert.equal(meta.body.ok, false);
  assert.equal(meta.body.error.code, "SSRF_BLOCKED");
  assert.match(meta.body.error.message, /targets\.linkLocal/);
  const selfCall = await ag("POST", "/v1/execute", { request: { url: `${agent.url}/v1/health`, method: "GET", headers: {} } });
  assert.match(selfCall.body.error.message, /does not send requests to itself/);
  const bad = await ag("POST", "/v1/execute", { request: { url: "file:///etc/passwd", method: "GET" } });
  assert.equal(bad.status, 400);

  const { makeAddressPolicy, classify } = await import("../agent/src/policy.js");
  assert.deepEqual(["127.0.0.1", "::1", "10.1.2.3", "192.168.0.10", "fd12::1", "169.254.169.254", "fe80::1", "8.8.8.8", "0.0.0.0", "::ffff:127.0.0.1"].map(classify),
    ["loopback", "loopback", "private", "private", "private", "linkLocal", "linkLocal", "public", "unspecified", "loopback"]);
  const def = makeAddressPolicy({});
  assert.equal(def("127.0.0.1", "localhost"), null);
  assert.equal(def("192.168.1.5", "router"), null);
  assert.equal(def("8.8.8.8", "dns.google"), null);
  assert.match(def("169.254.169.254", "metadata"), /linkLocal/);
  const onlyCorp = makeAddressPolicy({ allow: ["*.corp.local", "10.0.0.0/8"], deny: ["10.9.9.9"] });
  assert.equal(onlyCorp("8.8.8.8", "api.corp.local"), null);
  assert.equal(onlyCorp("10.1.1.1", "build"), null);
  assert.match(onlyCorp("8.8.8.8", "example.com"), /targets\.allow/);
  assert.match(onlyCorp("10.9.9.9", "x"), /targets\.deny/);
  assert.match(makeAddressPolicy({ public: false })("8.8.8.8", "x"), /targets\.public/);
});

test("live sessions through the agent: the server resolves variables, the agent connects and streams events", async () => {
  await call(tok, "PUT", `/workspaces/${ws}/environments/${envId}`, { name: "Local", variables: [{ key: "base", value: targetUrl }, { key: "ws", value: wsUrl }, { key: "who", value: "agent" }] });
  const prep = await call(tok, "POST", `/workspaces/${ws}/sessions/prepare`, { request: { protocol: "websocket", url: "{{ws}}/chat" }, environment_id: envId });
  assert.equal(prep.status, 200);
  assert.equal(prep.body.request.url, `${wsUrl}/chat`);
  assert.equal(prep.body.vars.who, "agent");
  // the server cannot open it itself (SSRF), the agent can
  assert.equal((await call(tok, "POST", `/workspaces/${ws}/sessions`, { request: { protocol: "websocket", url: "{{ws}}" }, environment_id: envId })).body.ok, false);
  const open = await ag("POST", "/v1/sessions", prep.body);
  assert.equal(open.status, 201, JSON.stringify(open.body));
  const id = open.body.id;
  assert.equal((await ag("POST", `/v1/sessions/${id}/act`, { action: "send", payload: { data: "hi {{who}}" } })).status, 200);
  const events = [];
  const ctl = new AbortController();
  const res = await fetch(`${agent.url}/v1/sessions/${id}/events`, { headers: { origin: site, authorization: `Bearer ${token}` }, signal: ctl.signal });
  const reader = res.body.getReader();
  let buf = "";
  while (!events.some((e) => e.type === "message" && e.direction === "in")) {
    buf += new TextDecoder().decode((await reader.read()).value);
    for (const m of buf.matchAll(/^data: (.+)$/gm)) events.push(JSON.parse(m[1]));
  }
  ctl.abort();
  assert.equal(events.find((e) => e.type === "message" && e.direction === "in").data, "echo:hi agent");
  // another paired site cannot see this connection
  assert.equal((await ag("DELETE", `/v1/sessions/${id}`, null, { auth: "nope" })).status, 401);
  assert.equal((await ag("DELETE", `/v1/sessions/${id}`)).status, 200);
  assert.ok((await ag("GET", "/v1/sessions")).body.find((s) => s.id === id).closed);
});

test("Local mode can be turned off by the server", async () => {
  config.localAgent = false;
  try {
    const r = await call(tok, "POST", `/workspaces/${ws}/run/prepare`, { request: { method: "GET", url: "{{base}}" } });
    assert.equal(r.status, 403);
    assert.equal((await call(tok, "POST", `/workspaces/${ws}/sessions/prepare`, { request: { protocol: "websocket", url: wsUrl } })).status, 403);
    assert.equal((await call(tok, "GET", "/agent")).body.enabled, false);
  } finally {
    config.localAgent = true;
  }
  const info = (await call(tok, "GET", "/agent")).body;
  assert.equal(info.enabled, true);
  assert.equal(info.server, site);
  assert.equal(info.defaultUrl, "http://127.0.0.1:47823");
});

test("the server hands out the agent: manifest with SHA-256, the bundle, install scripts with its address", { skip: !fs.existsSync(new URL("../dist/agent/agent.mjs", import.meta.url)) && "agent not built (npm run build)" }, async () => {
  const m = await (await fetch(`${site}/agent/manifest.json`)).json();
  assert.equal(m.version, JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url))).version);
  const file = Buffer.from(await (await fetch(`${site}${m.file}`)).arrayBuffer());
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(file).digest("hex"), m.sha256);
  const sh = await (await fetch(`${site}/agent/install.sh`)).text();
  assert.ok(sh.includes(`SERVER="${site}"`));
  assert.ok(!sh.includes("__SERVER__"));
  const ps1 = await (await fetch(`${site}/agent/install.ps1`)).text();
  assert.ok(ps1.includes(`$Server = '${site}'`));
  const evil = await rawHttp(server.address().port, { host: "x'$(id)", path: "/agent/install.sh" });
  assert.equal(evil.status, 400, "a strange Host never ends up in a script");
  assert.equal((await fetch(`${site}/agent/other.sh`)).status, 404);
});

test("updates: a newer version is installed only when its SHA-256 matches", async () => {
  const { applyUpdate, compareVersions } = await import("../agent/src/update.js");
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  const { createHash } = await import("node:crypto");
  const dir = agentHome();
  const target = `${dir}/agent.mjs`;
  fs.writeFileSync(target, "old");
  const fake = (body, sha) => async (url) => ({
    ok: true, status: 200,
    json: async () => ({ version: "99.0.0", file: "/agent/agent.mjs", sha256: sha ?? createHash("sha256").update(body).digest("hex"), minNode: "22.13.0" }),
    arrayBuffer: async () => Buffer.from(body),
    url,
  });
  await assert.rejects(applyUpdate({ server: "https://srv.example", target, current: "1.0.0", fetchImpl: fake("new", "0".repeat(64)) }), /Checksum mismatch/);
  assert.equal(fs.readFileSync(target, "utf8"), "old", "nothing changed");
  await assert.rejects(applyUpdate({ server: "https://srv.example", target, current: "1.0.0", expectSha256: "1".repeat(64), fetchImpl: fake("new") }), /does not match/);
  const r = await applyUpdate({ server: "https://srv.example", target, current: "1.0.0", fetchImpl: fake("new") });
  assert.deepEqual(r, { updated: true, version: "99.0.0", previous: "1.0.0" });
  assert.equal(fs.readFileSync(target, "utf8"), "new");
  assert.equal((await applyUpdate({ server: "https://srv.example", target, current: "99.0.0", fetchImpl: fake("x") })).updated, false, "already current");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("background service files for Linux (systemd), macOS (launchd) and Windows (Task Scheduler)", async () => {
  const { serviceSpec } = await import("../agent/src/service.js");
  const { agentPaths } = await import("../agent/src/paths.js");
  const nix = { command: ["/opt/my node/bin/node", '/home/a "b"/agent.mjs'] };
  const linux = serviceSpec({ platform: "linux", osEnv: {}, ...nix, paths: agentPaths({ platform: "linux", home: "/home/a", env: {} }), home: "/home/a" });
  assert.equal(linux.kind, "systemd");
  assert.equal(linux.files[0].path, "/home/a/.config/systemd/user/api-client-agent.service");
  assert.match(linux.files[0].content, /^ExecStart="\/opt\/my node\/bin\/node" "\/home\/a \\"b\\"\/agent\.mjs" "run"$/m);
  assert.match(linux.files[0].content, /Restart=on-failure/);
  assert.deepEqual(linux.install.at(-1), ["systemctl", ["--user", "enable", "--now", "api-client-agent.service"]], "a user service: no root");

  const mac = serviceSpec({ platform: "darwin", ...nix, paths: agentPaths({ platform: "darwin", home: "/Users/a", env: {} }), home: "/Users/a", uid: 501 });
  assert.equal(mac.files[0].path, "/Users/a/Library/LaunchAgents/com.apiclient.agent.plist");
  assert.ok(mac.files[0].content.includes("<string>/home/a &quot;b&quot;/agent.mjs</string>"), "XML-escaped");
  assert.match(mac.files[0].content, /<key>RunAtLoad<\/key><true\/>/);
  assert.deepEqual(mac.install[1], ["launchctl", ["bootstrap", "gui/501", "/Users/a/Library/LaunchAgents/com.apiclient.agent.plist"]]);

  const winPaths = agentPaths({ platform: "win32", home: "C:\\Users\\a", env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" } });
  assert.equal(winPaths.config, "C:\\Users\\a\\AppData\\Roaming\\api-client-agent");
  const win = serviceSpec({ platform: "win32", command: ["C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\o'neil\\agent.mjs"], paths: winPaths });
  assert.equal(win.kind, "task");
  assert.match(win.files[0].content, /& 'C:\\Program Files\\nodejs\\node\.exe' 'C:\\Users\\o''neil\\agent\.mjs' 'run'/, "PowerShell quoting");
  const [cmd, args] = win.install[0];
  assert.equal(cmd, "powershell.exe");
  const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
  assert.match(script, /Register-ScheduledTask -TaskName 'API Client Agent'/);
  assert.match(script, /-AtLogOn/);
  assert.match(script, /-RunLevel Limited/, "never elevated");
  assert.throws(() => serviceSpec({ platform: "aix", command: ["x"], paths: {} }), /Unsupported system/);
  // the standalone program (installers) runs itself; a .deb install uses the unit the package ships
  const exe = serviceSpec({ platform: "linux", osEnv: {}, command: ["/home/a/.local/share/api-client-agent/api-client-agent"], paths: agentPaths({ platform: "linux", home: "/home/a", env: {} }), home: "/home/a" });
  assert.match(exe.files[0].content, /^ExecStart="\/home\/a\/\.local\/share\/api-client-agent\/api-client-agent" "run"$/m);
  const deb = serviceSpec({ platform: "linux", osEnv: {}, command: ["/usr/lib/api-client-agent/api-client-agent"], paths: agentPaths({ platform: "linux", home: "/home/a", env: {} }), home: "/home/a", packaged: true });
  assert.deepEqual(deb.files, [], "nothing written to the home folder");
  assert.deepEqual(deb.install.at(-1), ["systemctl", ["--user", "enable", "--now", "api-client-agent.service"]]);
  const winExe = serviceSpec({ platform: "win32", command: ["C:\\Users\\a\\AppData\\Local\\api-client-agent\\api-client-agent.exe"], paths: winPaths });
  assert.match(winExe.files[0].content, /& 'C:\\Users\\a\\AppData\\Local\\api-client-agent\\api-client-agent\.exe' 'run'/);

  assert.deepEqual(agentPaths({ platform: "linux", home: "/h", env: { XDG_CONFIG_HOME: "/c" } }).config, "/c/api-client-agent");
  assert.deepEqual(agentPaths({ platform: "darwin", home: "/Users/a", env: {} }).config, "/Users/a/Library/Application Support/api-client-agent");
  assert.deepEqual(agentPaths({ platform: "win32", home: "C:\\h", env: { API_CLIENT_AGENT_HOME: "D:\\agent" } }).install, "D:\\agent");
});

test("agent settings from the CLI", () => {
  assert.match(cli(home, "config", "set", "targets.allow", "*.corp.local,10.0.0.0/8"), /targets\.allow = \["\*\.corp\.local","10\.0\.0\.0\/8"\]/);
  assert.throws(() => cli(home, "config", "set", "origins", "https://x"), /read-only/);
  assert.throws(() => cli(home, "config", "set", "targets.linkLocal", "maybe"), /true or false/);
  cli(home, "config", "set", "targets.allow", "");
  assert.match(cli(home, "origins"), new RegExp(site.replace(/[.]/g, "\\.")));
  assert.match(cli(home, "version"), /^\d+\.\d+\.\d+/);
});

test("installed-program extras: Windows Installed apps entry and PATH, ~/.local/bin on Linux and macOS", async () => {
  const { windowsIntegrationSpec, unixIntegrationSpec, UNINSTALL_KEY } = await import("../agent/src/integration.js");
  const w = windowsIntegrationSpec({ exe: "C:\\Users\\a\\AppData\\Local\\api-client-agent\\api-client-agent.exe", dir: "C:\\Users\\a\\AppData\\Local\\api-client-agent", version: "1.2.3", sizeKb: 90000 });
  const reg = Object.fromEntries(w.install.filter(([c]) => c === "reg").map(([, a]) => [a[3], a[7]]));
  assert.ok(UNINSTALL_KEY.startsWith("HKCU\\"), "per user: no administrator rights");
  assert.equal(reg.DisplayName, "API Client Agent");
  assert.equal(reg.DisplayVersion, "1.2.3");
  assert.equal(reg.UninstallString, '"C:\\Users\\a\\AppData\\Local\\api-client-agent\\api-client-agent.exe" uninstall --pause');
  const pathScript = Buffer.from(w.install.at(-1)[1].at(-1), "base64").toString("utf16le");
  assert.match(pathScript, /SetEnvironmentVariable\('Path', .*'User'\)/, "the user's PATH, not the machine's");
  assert.match(Buffer.from(w.uninstall.at(-1)[1].at(-1), "base64").toString("utf16le"), /Where-Object \{ \$_ -and \(\$_ -ne \$dir\) \}/, "uninstall takes only our folder out of PATH");
  assert.deepEqual(unixIntegrationSpec({ command: ["/h/.local/share/api-client-agent/api-client-agent"], home: "/h" }), { link: "/h/.local/bin/api-client-agent", target: "/h/.local/share/api-client-agent/api-client-agent" });
  assert.equal(unixIntegrationSpec({ command: ["/usr/bin/node", "/h/it's/agent.mjs"], home: "/h" }).script, `#!/bin/sh\nexec '/usr/bin/node' '/h/it'\\''s/agent.mjs' "$@"\n`);
});

test("standalone updates: the program for this system is picked from the manifest; Windows keeps the running .exe aside", async () => {
  const { pickAsset, replaceFile } = await import("../agent/src/update.js");
  const m = { url: "https://srv.example/agent/agent.mjs", sha256: "a".repeat(64), binaries: { "win32-x64": { file: "/agent/download/setup.exe", sha256: "b".repeat(64), kind: "exe" }, "linux-x64": { file: "/agent/download/a.tar.gz", sha256: "c".repeat(64), kind: "tar.gz" } } };
  assert.deepEqual(pickAsset(m, { standalone: false }), { url: m.url, sha256: m.sha256, kind: "script" });
  assert.deepEqual(pickAsset(m, { standalone: true, platform: "win32", arch: "x64" }), { url: "https://srv.example/agent/download/setup.exe", sha256: "b".repeat(64), kind: "exe" });
  assert.equal(pickAsset(m, { standalone: true, platform: "linux", arch: "x64" }).kind, "tar.gz");
  assert.throws(() => pickAsset(m, { standalone: true, platform: "darwin", arch: "arm64" }), /no standalone agent for darwin-arm64/);
  const dir = agentHome();
  fs.writeFileSync(`${dir}/api-client-agent.exe`, "old");
  replaceFile(`${dir}/api-client-agent.exe`, Buffer.from("new"), { platform: "win32" });
  assert.equal(fs.readFileSync(`${dir}/api-client-agent.exe`, "utf8"), "new");
  assert.equal(fs.readFileSync(`${dir}/api-client-agent.exe.old`, "utf8"), "old", "renamed, not overwritten (a running .exe cannot be)");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the server lists and serves the installers it has, and nothing else from that folder", async () => {
  const dir = agentHome();
  const { createHash } = await import("node:crypto");
  const body = Buffer.from("MZ fake installer");
  fs.writeFileSync(`${dir}/api-client-agent-setup-9.9.9-windows-x64.exe`, body);
  fs.writeFileSync(`${dir}/secret.txt`, "not listed");
  const sha = createHash("sha256").update(body).digest("hex");
  fs.writeFileSync(`${dir}/index.json`, JSON.stringify({ files: [
    { platform: "win32", arch: "x64", kind: "exe", file: "api-client-agent-setup-9.9.9-windows-x64.exe", size: body.length, sha256: sha },
    { platform: "linux", arch: "x64", kind: "deb", file: "../../etc/passwd", size: 1, sha256: sha },
    { platform: "linux", arch: "x64", kind: "deb", file: "missing.deb", size: 1, sha256: sha },
  ] }));
  config.agentInstallersDir = dir;
  try {
    const info = (await call(tok, "GET", "/agent")).body;
    assert.deepEqual(info.installers, [{ platform: "win32", arch: "x64", kind: "exe", url: "/agent/download/api-client-agent-setup-9.9.9-windows-x64.exe", size: body.length, sha256: sha }]);
    if (fs.existsSync(new URL("../dist/agent/agent.mjs", import.meta.url))) {
      const m = await (await fetch(`${site}/agent/manifest.json`)).json();
      assert.deepEqual(m.binaries, { "win32-x64": { file: "/agent/download/api-client-agent-setup-9.9.9-windows-x64.exe", sha256: sha, kind: "exe" } });
    }
    const dl = await fetch(`${site}/agent/download/api-client-agent-setup-9.9.9-windows-x64.exe`);
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get("content-disposition"), /attachment/);
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), body);
    for (const f of ["secret.txt", "index.json", "..%2F..%2Fetc%2Fpasswd", "missing.deb"]) assert.equal((await fetch(`${site}/agent/download/${f}`)).status, 404, f);
  } finally {
    config.agentInstallersDir = "";
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("download links point to the latest GitHub release's installers; off or unreachable: none (the UI uses the server's)", async () => {
  const { fakeGitHub, RELEASE_FILES, DOWNLOAD } = await import("./fixtures/github.js");
  const gh = await fakeGitHub({ extra: [{ name: "evil.deb", size: 1, browser_download_url: "javascript:alert(1)" }] });
  const saved = { agentReleases: config.agentReleases, githubApi: config.githubApi };
  try {
    Object.assign(config, { agentReleases: "owner/repo", githubApi: gh.url });
    const r = (await call(tok, "GET", "/agent/release")).body;
    assert.equal(r.version, "9.9.9");
    assert.equal(r.url, "https://github.com/owner/repo/releases/tag/v9.9.9");
    assert.deepEqual(r.installers, RELEASE_FILES.map((f) => ({ ...f, url: DOWNLOAD + f.file })), "only https links to the release's own files");
    await call(tok, "GET", "/agent/release");
    assert.equal(gh.hits, 1, "kept for a while, GitHub is not asked on every page load");
    assert.equal((await fetch(`${base}/agent/release`)).status, 401, "signed in only");

    config.agentReleases = "off";
    assert.equal((await call(tok, "GET", "/agent/release")).body, null);
    Object.assign(config, { agentReleases: "owner/repo", githubApi: "http://127.0.0.1:1" });
    assert.equal((await call(tok, "GET", "/agent/release")).body, null);
  } finally {
    Object.assign(config, saved);
    gh.close();
  }
});
