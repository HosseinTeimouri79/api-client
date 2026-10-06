import test from "node:test";
import assert from "node:assert/strict";
import { resolve, mergeScopes } from "../src/services/variables.js";
import { can, outranks } from "../src/services/permissions.js";
import { runScript } from "../src/services/scriptEngine.js";
import { buildRequest } from "../src/services/executor.js";
import { isPrivateIp } from "../src/services/ssrf.js";

test("variables: precedence and unresolved passthrough", () => {
  const v = mergeScopes({
    workspace: [
      { key: "a", value: "ws" },
      { key: "w", value: "W" },
    ],
    environment: [{ key: "a", value: "env" }],
    collections: [[{ key: "a", value: "root" }], [{ key: "a", value: "leaf" }]],
    request: [{ key: "b", value: "req" }],
    runtime: { b: "rt" },
  });
  assert.equal(v.a, "leaf");
  assert.equal(v.b, "rt");
  assert.equal(v.w, "W");
  assert.equal(resolve("{{a}}/{{ b }}/{{missing}}", v), "leaf/rt/{{missing}}");
  assert.equal(resolve("{{x}}", { x: "{{x}}" }), "{{x}}"); // cycle is bounded
});
test("variables: disabled entries are ignored", () =>
  assert.equal(
    resolve(
      "{{k}}",
      mergeScopes({ environment: [{ key: "k", value: "1", enabled: false }] }),
    ),
    "{{k}}",
  ));

test("permissions: role matrix", () => {
  assert.ok(can("viewer", "request:run"));
  assert.ok(!can("viewer", "content:write"));
  assert.ok(can("editor", "content:write"));
  assert.ok(!can("editor", "members:manage"));
  assert.ok(can("admin", "members:manage"));
  assert.ok(!can("admin", "workspace:delete"));
  assert.ok(can("owner", "workspace:delete"));
  assert.ok(outranks("admin", "editor"));
  assert.ok(!outranks("admin", "admin"));
});

const ctx = (o = {}) => ({
  variables: {},
  environment: {},
  collectionVariables: {},
  request: { url: "u", method: "GET" },
  ...o,
});
test("script: sets variables/env, tests, console", async () => {
  const r = await runScript(
    `pm.variables.set('t', 1); pm.environment.set('token', response.json().token); console.warn('w');
    test('status', () => expect(response.status).toBe(200)); test('bad', () => expect(response.status).toBe(500));`,
    ctx({
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: '{"token":"abc"}',
      },
    }),
  );
  assert.equal(r.variables.t, "1");
  assert.equal(r.environment.token, "abc");
  assert.deepEqual(
    r.tests.map((t) => t.passed),
    [true, false],
  );
  assert.equal(r.logs[0].level, "warn");
});
test("script: errors are captured, not thrown", async () => {
  const r = await runScript('throw new Error("boom")', ctx());
  assert.equal(r.ok, false);
  assert.match(r.error.message, /boom/);
});
test("script: infinite loop is interrupted", async () => {
  const r = await runScript("while(true){}", ctx(), { timeoutMs: 200 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /timed out/);
});
test("script: no host access", async () => {
  for (const code of [
    "process.exit(1)",
    'require("fs")',
    'fetch("http://x")',
    'globalThis.constructor.constructor("return process")()',
  ])
    assert.equal((await runScript(code, ctx())).ok, false, code);
});
test("script: memory bomb is contained", async () => {
  const r = await runScript(
    "const a=[];while(true)a.push(new Array(1e6).fill(1))",
    ctx(),
    { memoryBytes: 8 << 20 },
  );
  assert.equal(r.ok, false);
});

test("builder: params, auth, bodies", async () => {
  const b = await buildRequest({
    method: "POST",
    url: "api.test/x?a=1",
    params: [
      { key: "q", value: "v w" },
      { key: "off", value: "1", enabled: false },
    ],
    headers: [{ key: "X-A", value: "1" }],
    auth: { type: "bearer", token: "T" },
    body: { mode: "json", content: '{"a":1}' },
  });
  assert.equal(b.url, "http://api.test/x?a=1&q=v+w");
  assert.equal(b.headers.Authorization, "Bearer T");
  assert.equal(b.headers["Content-Type"], "application/json");
  const f = await buildRequest({
    method: "POST",
    url: "http://a.test",
    body: { mode: "urlencoded", fields: [{ key: "a", value: "b c" }] },
  });
  assert.equal(f.body, "a=b+c");
  const m = await buildRequest({
    method: "POST",
    url: "http://a.test",
    body: { mode: "multipart", fields: [{ key: "a", value: "b" }] },
  });
  assert.match(m.headers["Content-Type"], /multipart\/form-data; boundary=/);
  const k = await buildRequest({
    method: "GET",
    url: "http://a.test",
    auth: { type: "apikey", in: "query", key: "k", value: "v" },
    body: { mode: "json", content: "{}" },
  });
  assert.equal(k.url, "http://a.test/?k=v");
  assert.equal(k.body, undefined);
  await assert.rejects(
    buildRequest({
      method: "POST",
      url: "http://a.test",
      body: { mode: "json", content: "{bad" },
    }),
    /Invalid JSON/,
  );
  await assert.rejects(
    buildRequest({ method: "GET", url: "file:///etc/passwd" }),
    /http and https/,
  );
});
test("ssrf: private ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "192.168.0.5",
    "172.16.0.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])
    assert.ok(isPrivateIp(ip), ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"])
    assert.ok(!isPrivateIp(ip), ip);
});
test("ssrf: IP-literal targets are rejected before connecting", async () => {
  const { execute } = await import("../src/services/executor.js");
  for (const u of [
    "http://127.0.0.1:9/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://2130706433/",
    "http://0x7f.1/",
  ])
    await assert.rejects(
      execute({ url: u, method: "GET", headers: {} }),
      /SSRF/,
      u,
    );
});
