import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import {
  detect,
  parseImport,
  toPostmanCollection,
  toHoppCollection,
} from "../src/services/interop.js";

const postman = {
  info: {
    name: "Shop",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [{ key: "base", value: "https://x.io" }],
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{tok}}" }] },
  item: [
    {
      name: "Users",
      item: [
        {
          name: "List",
          request: {
            method: "GET",
            header: [
              { key: "X-A", value: "1" },
              { key: "X-B", value: "2", disabled: true },
            ],
            url: {
              raw: "{{base}}/users?page=1&q=a",
              query: [
                { key: "page", value: "1" },
                { key: "q", value: "a", disabled: true },
              ],
            },
          },
          event: [
            {
              listen: "test",
              script: { exec: ['pm.test("ok", () => pm.expect(1).toBe(1));'] },
            },
          ],
        },
        {
          name: "Create",
          request: {
            method: "POST",
            url: "{{base}}/users?dry=1",
            body: {
              mode: "raw",
              raw: '{"a":1}',
              options: { raw: { language: "json" } },
            },
            auth: {
              type: "basic",
              basic: [
                { key: "username", value: "u" },
                { key: "password", value: "p" },
              ],
            },
          },
        },
      ],
    },
    {
      name: "Form",
      request: {
        method: "POST",
        url: "{{base}}/f",
        body: { mode: "urlencoded", urlencoded: [{ key: "a", value: "b" }] },
      },
    },
  ],
};
const hopp = [
  {
    v: 1,
    name: "H",
    folders: [
      {
        v: 1,
        name: "Sub",
        folders: [],
        requests: [
          {
            v: "1",
            name: "R1",
            method: "post",
            endpoint: "<<base>>/x",
            params: [{ key: "p", value: "<<v>>", active: true }],
            headers: [{ key: "H", value: "1", active: false }],
            preRequestScript: 'pw.env.set("a","1")',
            testScript: 'pw.test("t", () => { pw.expect(1).toBe(1) })',
            auth: {
              authType: "api-key",
              authActive: true,
              key: "k",
              value: "v",
              addTo: "QUERY_PARAMS",
            },
            body: {
              contentType: "application/x-www-form-urlencoded",
              body: "a: 1\n#b: 2",
            },
          },
        ],
      },
    ],
    requests: [
      {
        v: "1",
        name: "Top",
        method: "GET",
        endpoint: "https://e.io",
        params: [],
        headers: [],
        preRequestScript: "",
        testScript: "",
        auth: { authType: "bearer", authActive: true, token: "t" },
        body: { contentType: null, body: null },
      },
    ],
  },
];

test("detect + parse postman", () => {
  assert.equal(detect(postman), "postman-collection");
  assert.equal(detect(hopp), "hoppscotch-collection");
  assert.equal(
    detect({ name: "e", values: [{ key: "a", value: "1" }] }),
    "postman-environment",
  );
  assert.equal(
    detect([{ name: "e", variables: [] }]),
    "hoppscotch-environment",
  );
  assert.equal(detect({ foo: 1 }), null);
  const c = parseImport(postman).collections[0],
    list = c.folders[0].requests[0];
  assert.equal(c.name, "Shop");
  assert.equal(c.auth.token, "{{tok}}");
  assert.equal(list.url, "{{base}}/users");
  assert.deepEqual(
    list.params.map((p) => p.enabled),
    [true, false],
  );
  assert.equal(list.headers[1].enabled, false);
  assert.match(list.post_script, /pm\.test/);
  assert.equal(c.folders[0].requests[1].body.mode, "json");
  assert.equal(c.folders[0].requests[1].params[0].key, "dry");
  assert.equal(c.requests.length, 1);
});
test("parse hoppscotch: vars, scripts, body, auth", () => {
  const c = parseImport(hopp).collections[0],
    r = c.folders[0].requests[0];
  assert.equal(r.method, "POST");
  assert.equal(r.url, "{{base}}/x");
  assert.equal(r.params[0].value, "{{v}}");
  assert.equal(r.auth.in, "query");
  assert.equal(r.pre_script, 'pm.environment.set("a","1")');
  assert.match(r.post_script, /pm\.test.*pm\.expect/s);
  assert.deepEqual(r.body.fields, [
    { key: "a", value: "1", enabled: true },
    { key: "b", value: "2", enabled: false },
  ]);
  assert.equal(c.requests[0].auth.type, "bearer");
});
test("round trip: postman -> neutral -> hoppscotch -> neutral keeps requests", () => {
  const n = parseImport(postman).collections[0],
    h = toHoppCollection(n);
  assert.equal(h.folders[0].requests[0].endpoint, "<<base>>/users");
  assert.equal(h.folders[0].requests[0].auth.authType, "bearer");
  assert.equal(h.folders[0].requests[1].auth.authType, "basic");
  const back = parseImport([h]).collections[0];
  assert.equal(back.folders[0].requests[0].url, "{{base}}/users");
  assert.equal(back.folders[0].requests[1].body.content, '{"a":1}');
  const p = toPostmanCollection(n, "id"),
    again = parseImport(p).collections[0];
  assert.equal(p.info.schema.includes("v2.1.0"), true);
  assert.equal(again.folders[0].requests[0].url, "{{base}}/users");
  assert.equal(again.folders[0].requests[0].params.length, 2);
  assert.equal(again.folders[0].requests[1].auth.type, "basic");
});

let server, base, tok, ws;
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
test("api: import postman+hoppscotch, export both, errors", async () => {
  const reg = await call("POST", "/auth/register", {
    name: "o",
    username: "o_user",
    password: "password123",
  });
  assert.equal(reg.status, 201);
  tok = reg.body.token ?? tok;
  if (!tok) {
    const l = await call("POST", "/auth/login", {
      username: "o_user",
      password: "password123",
    });
    tok = l.body.token;
  }
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
  const W = `/workspaces/${ws}`;
  const a = await call("POST", `${W}/import`, { data: postman });
  assert.equal(a.status, 201);
  assert.deepEqual([a.body.collections, a.body.requests], [2, 3]);
  const b = await call("POST", `${W}/import`, { data: hopp });
  assert.equal(b.status, 201);
  assert.equal(b.body.requests, 2);
  const e = await call("POST", `${W}/import`, {
    data: { name: "Dev", values: [{ key: "k", value: "v", type: "secret" }] },
  });
  assert.equal(e.body.environments, 1);
  assert.equal(
    (await call("POST", `${W}/import`, { data: { nope: 1 } })).status,
    400,
  );
  const tree = (await call("GET", `${W}/tree`)).body,
    shop = tree.collections.find((c) => c.name === "Shop");
  const px = (
    await call("GET", `${W}/export?format=postman&collection=${shop.id}`)
  ).body;
  assert.equal(px.data.info.name, "Shop");
  assert.equal(px.data.item[0].item.length, 2);
  assert.match(px.filename, /Shop\.postman-collection\.json/);
  const hx = (await call("GET", `${W}/export?format=hoppscotch`)).body;
  assert.equal(hx.data.length, 2);
  assert.equal((await call("GET", `${W}/export?format=postman`)).status, 400);
  const ex = (
    await call(
      "GET",
      `${W}/export?format=postman&environment=${(await call("GET", `${W}/environments`)).body[0].id}`,
    )
  ).body;
  assert.equal(ex.data.values[0].type, "secret");
  console.log(JSON.stringify(px.data).length, "bytes postman export ok");
});
