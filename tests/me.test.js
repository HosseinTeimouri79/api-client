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

const call = (token) => async (method, path, body, headers = {}) => {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(base + path, {
    method,
    headers: { ...(!raw && { "content-type": "application/json" }), ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: raw ? body : body && JSON.stringify(body),
  });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, ct, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const signup = async (username) => {
  const r = await call()("POST", "/auth/register", { username, password: "password123" });
  return { ...r.body.user, token: r.body.token, c: call(r.body.token) };
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("profile: name, username, locale", async () => {
  const a = await signup("amy");
  const b = await signup("ben");
  const r = await a.c("PATCH", "/me", { name: "Amy Adams", locale: "fa", username: "Amy2" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.user.name, r.body.user.username, r.body.user.locale], ["Amy Adams", "amy2", "fa"]);
  assert.equal((await a.c("GET", "/auth/me")).body.user.locale, "fa");
  assert.equal((await a.c("PATCH", "/me", { username: "ben" })).status, 409);
  assert.equal((await a.c("PATCH", "/me", { locale: "xx" })).status, 400);
  assert.equal((await a.c("PATCH", "/me", { name: "  " })).status, 400);
  assert.equal((await call()("PATCH", "/me", { name: "x" })).status, 401);
  // a user can't touch someone else's profile: the route only ever targets the caller
  assert.equal((await b.c("GET", "/auth/me")).body.user.name, "ben");
});

test("avatar: upload, serve, validate, remove", async () => {
  const a = await signup("cat");
  const other = await signup("dog");
  assert.equal((await a.c("GET", "/auth/me")).body.user.avatar, null);
  const up = await a.c("PUT", "/me/avatar", PNG, { "content-type": "image/png" });
  assert.equal(up.status, 200);
  const url = up.body.user.avatar;
  assert.match(url, new RegExp(`^/api/users/${a.id}/avatar\\?v=\\d+$`));
  const got = await other.c("GET", url.slice(4)); // other signed-in users can see it
  assert.equal(got.status, 200);
  assert.equal(got.ct, "image/png");
  assert.deepEqual(got.body, PNG);
  assert.equal((await call()("GET", url.slice(4))).status, 401);
  // wrong content: HTML/SVG labelled as an image, or a bad content type
  assert.equal((await a.c("PUT", "/me/avatar", Buffer.from("<svg onload=alert(1)>"), { "content-type": "image/png" })).status, 415);
  assert.equal((await a.c("PUT", "/me/avatar", Buffer.from("<svg/>"), { "content-type": "image/svg+xml" })).status, 415);
  assert.equal((await a.c("PUT", "/me/avatar", Buffer.alloc(500 * 1024, 1), { "content-type": "image/png" })).status, 413);
  // appears in member lists
  const ws = await a.c("POST", "/workspaces", { name: "W" });
  const members = await a.c("GET", `/workspaces/${ws.body.id}/members`);
  assert.equal(members.body[0].avatar, url);
  assert.ok(!("avatar_v" in members.body[0]));
  const del = await a.c("DELETE", "/me/avatar");
  assert.equal(del.body.user.avatar, null);
  assert.equal((await other.c("GET", url.slice(4))).status, 404);
});

test("password: needs the current one, revokes other sessions", async () => {
  const a = await signup("eli");
  const second = (await call()("POST", "/auth/login", { username: "eli", password: "password123" })).body.token;
  assert.equal((await a.c("POST", "/me/password", { current_password: "nope", new_password: "newpassword1" })).status, 400);
  assert.equal((await a.c("POST", "/me/password", { current_password: "password123", new_password: "short" })).status, 400);
  assert.equal((await a.c("POST", "/me/password", { current_password: "password123", new_password: "newpassword1" })).status, 200);
  assert.equal((await call(second)("GET", "/auth/me")).status, 401);
  assert.equal((await call()("POST", "/auth/login", { username: "eli", password: "password123" })).status, 401);
  assert.equal((await call()("POST", "/auth/login", { username: "eli", password: "newpassword1" })).status, 200);
});
