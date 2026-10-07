import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

let server, base, target, tbase;
const calls = [];
before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  target = http
    .createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        calls.push({ m: req.method, u: req.url, h: req.headers, b });
        if (req.url.startsWith("/redir")) {
          res.writeHead(302, { Location: "/json" });
          return res.end();
        }
        if (req.url.startsWith("/html")) {
          res.setHeader("content-type", "text/html");
          return res.end("<h1>hi</h1>");
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ token: "tok123", echo: b }));
      });
    })
    .listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
});
after(() => {
  server.close();
  target.close();
});

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
const signup = async (name) => {
  const r = await api()("POST", "/auth/register", {
    name,
    username: name,
    password: "password123",
  });
  assert.equal(r.status, 201);
  return { ...r.body.user, token: r.body.token, c: api(r.body.token) };
};
let owner, admin, editor, viewer, ws;

test("auth: register/login/me, bad credentials, unauthenticated", async () => {
  owner = await signup("owner");
  admin = await signup("admin");
  editor = await signup("editor");
  viewer = await signup("viewer");
  assert.equal(
    (
      await api()("POST", "/auth/register", {
        name: "x",
        username: "Owner", // case-insensitive duplicate
        password: "password123",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api()("POST", "/auth/login", {
        username: "owner",
        password: "wrongwrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api()("POST", "/auth/login", {
        username: "owner",
        password: "password123",
      })
    ).status,
    200,
  );
  assert.equal((await api()("GET", "/workspaces")).status, 401);
  assert.equal(
    (await owner.c("GET", "/auth/me")).body.user.username,
    "owner",
  );
});
test("csrf: cookie-authenticated mutation requires custom header", async () => {
  const login = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "owner", password: "password123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const bad = await fetch(base + "/workspaces", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: '{"name":"x"}',
  });
  assert.equal(bad.status, 403);
  const ok = await fetch(base + "/workspaces", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-requested-with": "api-client",
    },
    body: '{"name":"x"}',
  });
  assert.equal(ok.status, 201);
});
test("workspace + members + RBAC", async () => {
  ws = (await owner.c("POST", "/workspaces", { name: "Backend" })).body.id;
  for (const [u, role] of [
    [admin, "admin"],
    [editor, "editor"],
    [viewer, "viewer"],
  ])
    assert.equal(
      (
        await owner.c("POST", `/workspaces/${ws}/members`, {
          user_ids: [u.id],
          role,
        })
      ).status,
      201,
    );
  const out = await signup("outsider");
  assert.equal(
    (await out.c("GET", `/workspaces/${ws}/tree`)).status,
    404,
    "non-member cannot see workspace",
  );
  assert.equal(
    (await viewer.c("POST", `/workspaces/${ws}/collections`, { name: "c" }))
      .status,
    403,
  );
  assert.equal(
    (
      await editor.c("POST", `/workspaces/${ws}/members`, {
        user_ids: [out.id],
        role: "viewer",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin.c("POST", `/workspaces/${ws}/members`, {
        user_ids: [out.id],
        role: "admin",
      })
    ).status,
    403,
    "admin cannot mint admins",
  );
  assert.equal(
    (
      await admin.c("POST", `/workspaces/${ws}/members`, {
        user_ids: [out.id],
        role: "viewer",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await admin.c("PATCH", `/workspaces/${ws}/members/${owner.id}`, {
        role: "viewer",
      })
    ).status,
    403,
    "owner immutable",
  );
  assert.equal(
    (
      await admin.c("PATCH", `/workspaces/${ws}/members/${admin.id}`, {
        role: "editor",
      })
    ).status,
    403,
    "no self role change",
  );
  assert.equal((await editor.c("DELETE", `/workspaces/${ws}`)).status, 403);
  assert.equal(
    (
      await owner.c("PATCH", `/workspaces/${ws}/members/${out.id}`, {
        role: "editor",
      })
    ).status,
    200,
  );
  assert.equal(
    (await out.c("DELETE", `/workspaces/${ws}/members/${out.id}`)).status,
    200,
    "member can leave",
  );
  assert.equal(
    (await owner.c("GET", `/workspaces/${ws}/members`)).body.length,
    4,
  );
});
let col, sub, reqId, env;
test("collections tree: create, nest, duplicate, move, cycle guard", async () => {
  col = (
    await editor.c("POST", `/workspaces/${ws}/collections`, {
      name: "Users API",
    })
  ).body.id;
  sub = (
    await editor.c("POST", `/workspaces/${ws}/collections`, {
      name: "Sub",
      parent_id: col,
    })
  ).body.id;
  assert.equal(
    (
      await editor.c("PATCH", `/workspaces/${ws}/collections/${col}`, {
        parent_id: sub,
      })
    ).status,
    400,
  );
  const dup = (
    await editor.c("POST", `/workspaces/${ws}/collections/${col}/duplicate`)
  ).body.id;
  const tree = (await viewer.c("GET", `/workspaces/${ws}/tree`)).body;
  assert.equal(tree.collections.length, 4);
  assert.ok(tree.collections.find((c) => c.id === dup));
  assert.equal(
    (
      await editor.c("PATCH", `/workspaces/${ws}/collections/${sub}`, {
        name: "Renamed",
      })
    ).status,
    200,
  );
});
test("workspace isolation: cannot reference another workspace's collection", async () => {
  const ws2 = (await owner.c("POST", "/workspaces", { name: "Other" })).body.id;
  assert.equal(
    (
      await owner.c("POST", `/workspaces/${ws2}/collections`, {
        name: "x",
        parent_id: col,
      })
    ).status,
    404,
  );
  assert.equal(
    (await owner.c("GET", `/workspaces/${ws2}/collections/${col}`)).status,
    404,
  );
});
test("request CRUD + move + validation", async () => {
  const body = {
    name: "Login",
    method: "POST",
    url: "{{baseUrl}}/login",
    body: { mode: "json", content: '{"u":"{{user}}"}' },
    headers: [{ key: "X-T", value: "{{token}}" }],
  };
  const r = await editor.c(
    "POST",
    `/workspaces/${ws}/collections/${col}/requests`,
    body,
  );
  assert.equal(r.status, 201);
  reqId = r.body.id;
  assert.equal(
    (
      await editor.c("POST", `/workspaces/${ws}/collections/${col}/requests`, {
        ...body,
        method: "TRACE",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await editor.c("PATCH", `/workspaces/${ws}/requests/${reqId}/move`, {
        collection_id: sub,
      })
    ).status,
    200,
  );
  assert.equal(
    (await viewer.c("GET", `/workspaces/${ws}/requests/${reqId}`)).body
      .collection_id,
    sub,
  );
  assert.equal(
    (await viewer.c("PUT", `/workspaces/${ws}/requests/${reqId}`, body)).status,
    403,
  );
});
test("execution: variables (env/collection), scripts, persistence of env, history, viewer can run", async () => {
  env = (
    await editor.c("POST", `/workspaces/${ws}/environments`, {
      name: "dev",
      variables: [
        { key: "baseUrl", value: tbase },
        { key: "token", value: "old" },
      ],
    })
  ).body.id;
  await editor.c("PATCH", `/workspaces/${ws}/collections/${col}`, {
    variables: [{ key: "user", value: "bob" }],
    pre_script: `pm.variables.set('stamp','S'); pm.request.headers.add('X-Pre','1')`,
    post_script: `pm.environment.set('token', response.json().token); test('200', () => expect(response.status).toBe(200))`,
    auth: { type: "bearer", token: "COLL" },
  });
  const saved = (await editor.c("GET", `/workspaces/${ws}/requests/${reqId}`))
    .body;
  const run = await editor.c("POST", `/workspaces/${ws}/run`, {
    request: saved,
    collection_id: sub,
    environment_id: env,
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.error, null, JSON.stringify(run.body));
  assert.equal(run.body.response.status, 200);
  const sent = calls.at(-1);
  assert.equal(sent.m, "POST");
  assert.equal(sent.b, '{"u":"bob"}');
  assert.equal(sent.h["x-pre"], "1");
  assert.equal(
    sent.h.authorization,
    "Bearer COLL",
    "auth inherited from parent collection",
  );
  assert.equal(sent.h["x-t"], "old");
  assert.deepEqual(run.body.tests, [{ name: "200", passed: true }]);
  const envNow = (
    await viewer.c("GET", `/workspaces/${ws}/environments`)
  ).body.find((e) => e.id === env);
  assert.equal(
    envNow.variables.find((v) => v.key === "token").value,
    "tok123",
    "post-script persisted env var",
  );
  assert.ok(
    run.body.logs.some(
      (l) =>
        l.level === "INFO" && /Pre-request script executed/.test(l.message),
    ),
  );
  const vrun = await viewer.c("POST", `/workspaces/${ws}/run`, {
    request: { ...saved, post_script: `pm.environment.set('token','HACK')` },
    collection_id: col,
    environment_id: env,
  });
  assert.equal(vrun.status, 200);
  assert.equal(
    (await viewer.c("GET", `/workspaces/${ws}/environments`)).body
      .find((e) => e.id === env)
      .variables.find((v) => v.key === "token").value,
    "tok123",
    "viewer run never persists",
  );
  const h = (await viewer.c("GET", `/workspaces/${ws}/history`)).body;
  assert.equal(h.length, 1, "history is per-user");
  assert.equal(
    (await editor.c("GET", `/workspaces/${ws}/history`)).body.length,
    1,
  );
  assert.equal(
    (await viewer.c("DELETE", `/workspaces/${ws}/history`)).status,
    200,
  );
  assert.equal(
    (await viewer.c("GET", `/workspaces/${ws}/history`)).body.length,
    0,
  );
});
test("execution: redirects, HTML, network error shape, script error blocks request, SSRF", async () => {
  const run = (request) =>
    editor.c("POST", `/workspaces/${ws}/run`, {
      request: { name: "t", ...request },
    });
  assert.equal(
    (await run({ method: "GET", url: `${tbase}/redir` })).body.response.status,
    200,
  );
  const html = (await run({ method: "GET", url: `${tbase}/html` })).body
    .response;
  assert.match(html.contentType, /html/);
  assert.equal(html.body, "<h1>hi</h1>");
  const refused = (await run({ method: "GET", url: "http://127.0.0.1:1/x" }))
    .body;
  assert.equal(refused.error.phase, "network");
  assert.match(
    refused.error.message,
    /Unable to connect to: .*\nReason: Connection refused/,
  );
  const n = calls.length;
  const bad = (
    await run({
      method: "GET",
      url: `${tbase}/x`,
      pre_script: 'throw new Error("nope")',
    })
  ).body;
  assert.equal(bad.error.phase, "script");
  assert.equal(calls.length, n, "request not sent after failed pre-script");
  const inv = (
    await run({
      method: "POST",
      url: `${tbase}/x`,
      body: { mode: "json", content: "{" },
    })
  ).body;
  assert.equal(inv.error.phase, "validation");
  assert.equal(calls.length, n, "invalid body never sent");
  config.allowPrivateTargets = false;
  const blocked = (await run({ method: "GET", url: `${tbase}/x` })).body;
  config.allowPrivateTargets = true;
  assert.match(blocked.error.message, /SSRF/);
  assert.equal(calls.length, n, "private target never contacted");
});
test("audit log is admin-only and records changes", async () => {
  assert.equal((await editor.c("GET", `/workspaces/${ws}/audit`)).status, 403);
  assert.ok(
    (await admin.c("GET", `/workspaces/${ws}/audit`)).body.some(
      (a) => a.action === "request.create",
    ),
  );
});
