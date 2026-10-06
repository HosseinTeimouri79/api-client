import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";

let server, base, tok, W;
before(() => {
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());
const call = async (m, p, b) => {
  const r = await fetch(base + p, {
    method: m,
    headers: {
      "content-type": "application/json",
      "x-requested-with": "api-client",
      ...(tok && { authorization: `Bearer ${tok}` }),
    },
    body: b && JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("tree flags + inherited scripts endpoint (root -> leaf, only collections that define scripts)", async () => {
  const reg = await call("POST", "/auth/register", {
    name: "o",
    email: "cs@t.io",
    password: "password123",
  });
  assert.equal(reg.status, 201);
  tok = reg.body.token ?? tok;
  if (!tok)
    tok = (
      await call("POST", "/auth/login", {
        email: "cs@t.io",
        password: "password123",
      })
    ).body.token;
  W = `/workspaces/${(await call("POST", "/workspaces", { name: "W" })).body.id}`;
  const A = (await call("POST", `${W}/collections`, { name: "A" })).body.id;
  const B = (
    await call("POST", `${W}/collections`, { name: "B", parent_id: A })
  ).body.id;
  const C = (
    await call("POST", `${W}/collections`, { name: "C", parent_id: B })
  ).body.id;
  await call("PATCH", `${W}/collections/${A}`, {
    pre_script: 'pm.variables.set("a", 1)',
  });
  await call("PATCH", `${W}/collections/${B}`, {
    post_script: 'test("b", () => {})',
  });
  await call("PATCH", `${W}/collections/${C}`, { pre_script: "   \n " }); // whitespace only == no script

  const flags = Object.fromEntries(
    (await call("GET", `${W}/tree`)).body.collections.map((c) => [
      c.name,
      [c.has_pre, c.has_post],
    ]),
  );
  assert.deepEqual(flags, {
    A: [true, false],
    B: [false, true],
    C: [false, false],
  });

  const s = await call("GET", `${W}/collections/${C}/scripts`);
  assert.equal(s.status, 200);
  assert.deepEqual(
    s.body.map((x) => [x.id, x.path]),
    [
      [A, "A"],
      [B, "A / B"],
    ],
  );
  assert.match(s.body[0].pre_script, /pm\.variables\.set/);
  assert.match(s.body[1].post_script, /test\("b"/);
  assert.deepEqual(
    (await call("GET", `${W}/collections/${A}/scripts`)).body.map(
      (x) => x.path,
    ),
    ["A"],
  );
  assert.equal(
    (await call("GET", `${W}/collections/nope/scripts`)).status,
    404,
  );

  // clearing a script removes the reference
  await call("PATCH", `${W}/collections/${A}`, { pre_script: "" });
  assert.deepEqual(
    (await call("GET", `${W}/collections/${C}/scripts`)).body.map(
      (x) => x.path,
    ),
    ["A / B"],
  );
});

test("import with only=environment never creates collections (Environments dialog guard)", async () => {
  const before = (await call("GET", `${W}/tree`)).body.collections.length;
  const coll = {
    info: {
      name: "Nope",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [{ name: "R", request: { method: "GET", url: "https://x.io" } }],
  };
  const bad = await call("POST", `${W}/import`, {
    data: coll,
    only: "environment",
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not an environment/);
  assert.equal(
    (await call("GET", `${W}/tree`)).body.collections.length,
    before,
    "rejected import must not create anything",
  );
  const env = {
    name: "Staging",
    values: [{ key: "k", value: "v", enabled: true }],
  };
  const ok = await call("POST", `${W}/import`, {
    data: env,
    only: "environment",
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.environments, 1);
  assert.ok(
    (await call("GET", `${W}/environments`)).body.some(
      (e) => e.name === "Staging",
    ),
  );
  assert.equal(
    (await call("POST", `${W}/import`, { data: env, only: "collection" }))
      .status,
    400,
  );
  // export -> import round trip of an environment keeps its variables
  const id = (await call("GET", `${W}/environments`)).body.find(
    (e) => e.name === "Staging",
  ).id;
  const exp = (
    await call("GET", `${W}/export?format=postman&environment=${id}`)
  ).body;
  const re = await call("POST", `${W}/import`, {
    data: exp.data,
    only: "environment",
  });
  assert.equal(re.body.environments, 1);
  assert.equal(
    (await call("GET", `${W}/environments`)).body.filter(
      (e) => e.name === "Staging",
    ).length,
    2,
  );
});
