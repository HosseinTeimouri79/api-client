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
const call = (token) => async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("collection auth endpoint: nearest ancestor that sets auth wins; other workspaces are off limits", async () => {
  const reg = async (u) => (await call()("POST", "/auth/register", { username: u, password: "password123" })).body.token;
  const a = call(await reg("anna")), b = call(await reg("bert"));
  const ws = (await a("POST", "/workspaces", { name: "W" })).body.id;
  const root = (await a("POST", `/workspaces/${ws}/collections`, { name: "root" })).body.id;
  const child = (await a("POST", `/workspaces/${ws}/collections`, { name: "child", parent_id: root })).body.id;
  const leaf = (await a("POST", `/workspaces/${ws}/collections`, { name: "leaf", parent_id: child })).body.id;
  const get = (id) => a("GET", `/workspaces/${ws}/collections/${id}/auth`);
  assert.deepEqual((await get(leaf)).body, { auth: null });
  await a("PATCH", `/workspaces/${ws}/collections/${root}`, { auth: { type: "bearer", token: "root-token" } });
  assert.deepEqual((await get(leaf)).body, { auth: { type: "bearer", token: "root-token" } });
  await a("PATCH", `/workspaces/${ws}/collections/${child}`, { auth: { type: "inherit" } }); // "inherit" keeps looking up
  assert.equal((await get(leaf)).body.auth.token, "root-token");
  await a("PATCH", `/workspaces/${ws}/collections/${child}`, { auth: { type: "apikey", key: "X-Key", value: "v" } });
  assert.equal((await get(leaf)).body.auth.type, "apikey");
  assert.equal((await b("GET", `/workspaces/${ws}/collections/${leaf}/auth`)).status, 404); // not a member
});
