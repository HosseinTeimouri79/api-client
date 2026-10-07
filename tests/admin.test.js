import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";

let server, base;
before(() => {
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const api = (token) => async (method, path, body) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const signup = async (username) => {
  const r = await api()("POST", "/auth/register", { username, password: "password123" });
  assert.equal(r.status, 201);
  return { ...r.body.user, token: r.body.token, c: api(r.body.token) };
};
let root, bob, carol;

test("first account is admin, later ones are not; admin routes are guarded", async () => {
  root = await signup("root");
  bob = await signup("bob");
  carol = await signup("carol");
  assert.equal(root.is_admin, true);
  assert.equal(bob.is_admin, false);
  assert.equal((await bob.c("GET", "/auth/me")).body.user.is_admin, false);
  assert.equal((await bob.c("GET", "/admin/users")).status, 403);
  assert.equal((await api()("GET", "/admin/users")).status, 401);
  const list = await root.c("GET", "/admin/users");
  assert.equal(list.body.total, 3);
  assert.equal((await root.c("GET", "/admin/users?q=ca")).body.users[0].username, "carol");
  assert.equal((await root.c("GET", "/admin/stats")).body.users, 3);
});

test("create, rename, promote", async () => {
  const c = await root.c("POST", "/admin/users", { username: "Dave", password: "password123", is_admin: true });
  assert.equal(c.status, 201);
  assert.equal(c.body.username, "dave");
  assert.equal((await root.c("POST", "/admin/users", { username: "dave", password: "password123" })).status, 409);
  assert.equal((await root.c("PATCH", `/admin/users/${bob.id}`, { username: "dave" })).status, 409);
  assert.equal((await root.c("PATCH", `/admin/users/${bob.id}`, { name: "Bobby", is_admin: true })).status, 200);
  assert.equal((await bob.c("GET", "/admin/stats")).status, 200);
  await root.c("PATCH", `/admin/users/${bob.id}`, { is_admin: false });
  assert.equal((await bob.c("GET", "/admin/stats")).status, 403);
});

test("password reset signs the user out and the new password works", async () => {
  assert.equal((await root.c("POST", `/admin/users/${carol.id}/password`, { password: "short" })).status, 400);
  assert.equal((await root.c("POST", `/admin/users/${carol.id}/password`, { password: "brandnew-pass" })).status, 200);
  assert.equal((await carol.c("GET", "/auth/me")).status, 401); // old token revoked
  assert.equal((await api()("POST", "/auth/login", { username: "carol", password: "password123" })).status, 401);
  const login = await api()("POST", "/auth/login", { username: "carol", password: "brandnew-pass" });
  assert.equal(login.status, 200);
  assert.equal((await api(login.body.token)("GET", "/auth/me")).status, 200);
});

test("resetting your own password keeps your session", async () => {
  const r = await root.c("POST", `/admin/users/${root.id}/password`, { password: "root-new-pass" });
  assert.equal(r.status, 200);
  root.c = api(r.body.token);
  assert.equal((await root.c("GET", "/auth/me")).status, 200);
});

test("disabled users cannot sign in or use old tokens; re-enabling doesn't revive them", async () => {
  assert.equal((await root.c("PATCH", `/admin/users/${bob.id}`, { disabled: true })).status, 200);
  assert.equal((await bob.c("GET", "/auth/me")).status, 401);
  assert.equal((await api()("POST", "/auth/login", { username: "bob", password: "password123" })).status, 403);
  await root.c("PATCH", `/admin/users/${bob.id}`, { disabled: false });
  assert.equal((await bob.c("GET", "/auth/me")).status, 401);
  assert.equal((await api()("POST", "/auth/login", { username: "bob", password: "password123" })).status, 200);
});

test("admins cannot lock themselves out", async () => {
  assert.equal((await root.c("PATCH", `/admin/users/${root.id}`, { is_admin: false })).status, 400);
  assert.equal((await root.c("PATCH", `/admin/users/${root.id}`, { disabled: true })).status, 400);
  assert.equal((await root.c("DELETE", `/admin/users/${root.id}`)).status, 400);
});

test("delete user: blocked while they own a workspace", async () => {
  const eve = await signup("eve");
  const ws = await eve.c("POST", "/workspaces", { name: "Eve space" });
  assert.equal((await root.c("DELETE", `/admin/users/${eve.id}`)).status, 409);
  const all = await root.c("GET", "/admin/workspaces?q=eve");
  assert.equal(all.body[0].owner, "eve");
  assert.equal((await root.c("DELETE", `/admin/workspaces/${ws.body.id}`)).status, 200);
  assert.equal((await root.c("DELETE", `/admin/users/${eve.id}`)).status, 200);
  assert.equal((await root.c("DELETE", `/admin/users/${eve.id}`)).status, 404);
});

test("admin actions are audited", async () => {
  const a = await root.c("GET", "/admin/audit");
  assert.ok(a.body.some((x) => x.action === "admin.user.password_reset" && x.target === "carol" && x.user === "root"));
});

test("admin can close self-registration; only admins can then create users", async () => {
  assert.equal((await api()("GET", "/auth/config")).body.registration, true);
  const plain = await signup("plain");
  assert.equal((await plain.c("PATCH", "/admin/settings", { registration_open: false })).status, 403);
  assert.equal((await root.c("PATCH", "/admin/settings", { registration_open: false })).status, 200);
  assert.equal((await root.c("GET", "/admin/settings")).body.registration_open, false);
  assert.equal((await api()("GET", "/auth/config")).body.registration, false);
  const denied = await api()("POST", "/auth/register", { username: "mallory", password: "password123" });
  assert.equal(denied.status, 403);
  assert.equal((await api()("POST", "/auth/login", { username: "mallory", password: "password123" })).status, 401);
  // the admin creates the account and the user signs in with the password they were given
  assert.equal((await root.c("POST", "/admin/users", { username: "frank", password: "given-pass-1" })).status, 201);
  assert.equal((await api()("POST", "/auth/login", { username: "frank", password: "given-pass-1" })).status, 200);
  // reopen
  await root.c("PATCH", "/admin/settings", { registration_open: true });
  assert.equal((await api()("POST", "/auth/register", { username: "mallory", password: "password123" })).status, 201);
});

test("registration closed still allows the very first account", async () => {
  const db = openDb(":memory:");
  const s = createApp(db).listen(0);
  try {
    const url = `http://127.0.0.1:${s.address().port}/api`;
    db.prepare("INSERT INTO settings(key,value) VALUES('registration_open','false')").run();
    const reg = (u) => fetch(url + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "password123" }) });
    assert.equal((await (await fetch(url + "/auth/config")).json()).registration, true);
    assert.equal((await reg("first")).status, 201);
    assert.equal((await (await fetch(url + "/auth/config")).json()).registration, false);
    assert.equal((await reg("second")).status, 403);
  } finally { s.close(); }
});
