// Per-user app settings, stored on the account.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { SettingsSchema } from "../src/services/userSettings.js";
import { DEFAULT_SETTINGS } from "../web/src/lib/settings.js";

let server, base, tok;
before(async () => {
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "setter", password: "password123" }) })).json()).token;
});
after(() => server.close());
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("the UI's default settings match the server's schema", () => {
  assert.deepEqual(DEFAULT_SETTINGS, SettingsSchema.parse({}));
});

test("settings: saved on the account, validated, defaults filled in", async () => {
  assert.equal((await call("GET", "/auth/me")).body.user.settings, null);
  const next = { ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, fontSize: 16, indentType: "tab", indentCount: 4, fontFamily: '"Fira Code", monospace' }, app: { ...DEFAULT_SETTINGS.app, theme: "light", autosave: true } };
  const r = await call("PATCH", "/me", { settings: next });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.user.settings, next);
  assert.deepEqual((await call("GET", "/auth/me")).body.user.settings, next); // follows the account
  // a partial object is completed with defaults; unknown keys are dropped
  const p = await call("PATCH", "/me", { settings: { request: { timeoutMs: 5000 }, bogus: 1 } });
  assert.deepEqual(p.body.user.settings, { ...DEFAULT_SETTINGS, request: { ...DEFAULT_SETTINGS.request, timeoutMs: 5000 } });
  // other profile edits leave settings alone
  await call("PATCH", "/me", { name: "Setter" });
  assert.equal((await call("GET", "/auth/me")).body.user.settings.request.timeoutMs, 5000);
  // bad values are refused
  for (const bad of [{ editor: { indentCount: 0 } }, { editor: { fontSize: 100 } }, { editor: { fontFamily: "x; } body { display:none" } }, { app: { theme: "pink" } }, { request: { timeoutMs: -1 } }, { ui: { layout: "diagonal" } }])
    assert.equal((await call("PATCH", "/me", { settings: bad })).status, 400, JSON.stringify(bad));
});
