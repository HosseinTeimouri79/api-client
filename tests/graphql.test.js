// GraphQL: queries and mutations over HTTP (through /run), subscriptions over WebSocket (sessions), analysis and introspection.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startGraphqlServer } from "./fixtures/graphql-server.js";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { analyze, graphqlAsHttp } from "../src/protocols/graphql.js";

let server, base, gql, tok, ws, col;
before(async () => {
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  gql = await startGraphqlServer();
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gqluser", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
  col = (await call("POST", `/workspaces/${ws}/collections`, { name: "C" })).body.id;
});
after(() => { server.close(); gql.stop(); });
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const req = (data, extra = {}) => ({ protocol: "graphql", method: "POST", url: gql.http, params: [], headers: [], body: { mode: "none" }, protocol_data: data, ...extra });
const run = (data, extra, more = {}) => call("POST", `/workspaces/${ws}/run`, { request: req(data, extra), ...more });
const open = (data, extra, more = {}) => call("POST", `/workspaces/${ws}/sessions`, { request: req(data, { url: gql.ws, ...extra }), ...more });
async function events(id, until = (e) => e.some((x) => x.type === "closed")) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/workspaces/${ws}/sessions/${id}/events`, { headers: { authorization: `Bearer ${tok}` }, signal: ctl.signal });
  const out = [];
  let buf = "";
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const d = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (d && d.length > 8) out.push(JSON.parse(d.slice(6)));
      }
      if (until(out)) break;
    }
  } catch (e) { if (e.name !== "AbortError") throw e; } finally { clearTimeout(timer); ctl.abort(); }
  return out;
}

test("analyze finds operations, their types and syntax errors", async () => {
  assert.deepEqual(analyze("query A { hello } mutation B { setCounter(value: 1) } subscription C { countdown }"), {
    ok: true, operations: [{ name: "A", type: "query" }, { name: "B", type: "mutation" }, { name: "C", type: "subscription" }],
    current: { name: "A", type: "query" }, ambiguous: true });
  assert.deepEqual(analyze("query A { hello } subscription C { countdown }", "C").current, { name: "C", type: "subscription" });
  assert.equal(analyze("{ hello }").current.type, "query");
  assert.equal(analyze("query A { hello }", "Nope").current, null);
  assert.deepEqual(analyze("   "), { ok: true, operations: [], current: null });
  const bad = analyze("query { hello ");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Expected Name|Unexpected|Expected/);
  assert.equal(bad.line, 1);
  const r = await call("POST", `/workspaces/${ws}/graphql/analyze`, { query: "subscription { countdown }" });
  assert.equal(r.body.current.type, "subscription");
});

test("a query runs as HTTP POST with JSON, Accept header and the response comes back", async () => {
  const r = await run({ query: "query Hi($n: String) { hello(name: $n) }", variables: '{"n":"{{who}}"}' }, { variables: [{ key: "who", value: "gql" }] });
  assert.equal(r.body.error, null, JSON.stringify(r.body.error));
  assert.equal(r.body.response.status, 200);
  assert.deepEqual(JSON.parse(r.body.response.body), { data: { hello: "hello gql" } });
  const sent = gql.seen.at(-1);
  assert.deepEqual([sent.method, sent.ctype], ["POST", "application/json"]);
  assert.match(sent.accept, /application\/graphql-response\+json/);
  assert.equal(r.body.sent.method, "POST");
  assert.deepEqual(JSON.parse(r.body.sent.body), { query: "query Hi($n: String) { hello(name: $n) }", variables: { n: "gql" } });
});

test("variables, operationName, headers and auth", async () => {
  const doc = "query A { hello } query B($i: Input!) { echo(input: $i) }";
  const r = await run({ query: doc, operationName: "B", variables: '{"i":{"a":1,"b":["x"]}}' }, { auth: { type: "bearer", token: "tok9" }, headers: [{ key: "Accept", value: "application/json" }] });
  assert.deepEqual(JSON.parse(r.body.response.body).data, { echo: '{"a":1,"b":["x"]}' });
  assert.equal(gql.seen.at(-1).auth, "Bearer tok9");
  assert.equal(gql.seen.at(-1).accept, "application/json", "the user's Accept header wins");
  const me = await run({ query: "{ me }" }, { auth: { type: "bearer", token: "t2" } });
  assert.equal(JSON.parse(me.body.response.body).data.me, "Bearer t2");
});

test("a mutation, and GraphQL errors arrive as a normal response", async () => {
  const m = await run({ query: "mutation { setCounter(value: 7) }" });
  assert.deepEqual(JSON.parse(m.body.response.body), { data: { setCounter: 7 } });
  const e = await run({ query: "{ boom }" });
  const body = JSON.parse(e.body.response.body);
  assert.equal(body.errors[0].message, "kaboom");
  assert.equal(e.body.error, null);
});

test("GET sends the document in the query string; mutations refuse GET", async () => {
  const r = await run({ query: "query Q($n: String) { hello(name: $n) }", variables: '{"n":"get"}', operationName: "Q", httpMethod: "GET" }, { params: [{ key: "x", value: "1" }] });
  assert.equal(JSON.parse(r.body.response.body).data.hello, "hello get");
  const sent = gql.seen.at(-1);
  assert.equal(sent.method, "GET");
  const q = new URLSearchParams(sent.query);
  assert.deepEqual([q.get("x"), q.get("operationName"), q.get("variables")], ["1", "Q", '{"n":"get"}']);
  const bad = await run({ query: "mutation { setCounter(value: 1) }", httpMethod: "GET" });
  assert.equal(bad.body.error.phase, "validation");
  assert.match(bad.body.error.message, /Mutations cannot be sent with GET/);
});

test("clear validation errors before anything is sent", async () => {
  const cases = [
    [{ query: "" }, /Write a query first/],
    [{ query: "query {" }, /Invalid GraphQL/],
    [{ query: "query A { hello } query B { me }" }, /several operations/],
    [{ query: "query A { hello }", operationName: "Z" }, /no operation named "Z"/],
    [{ query: "{ hello }", variables: "{oops" }, /Variables is not valid JSON/],
    [{ query: "{ hello }", variables: "[1]" }, /must be a JSON object/],
    [{ query: "subscription { countdown }" }, /Subscribe/],
  ];
  for (const [data, re] of cases) {
    const r = await run(data);
    assert.equal(r.body.error?.phase, "validation", JSON.stringify(data));
    assert.match(r.body.error.message, re);
  }
  assert.throws(() => graphqlAsHttp({ protocol_data: { query: "" } }), /Write a query first/);
});

test("scripts, tests and history work for GraphQL requests", async () => {
  const r = await call("POST", `/workspaces/${ws}/run`, { request: req({ query: "{ hello }" }, { post_script: 'pm.test("greets", () => pm.expect(pm.response.json().data.hello).to.eql("hello world"));' }) });
  assert.deepEqual(r.body.tests.map((t) => [t.name, t.passed]), [["greets", true]]);
  const hist = (await call("GET", `/workspaces/${ws}/history`)).body;
  assert.equal(hist[0].method, "GQL");
});

test("introspection returns the schema as SDL; failures are explained", async () => {
  const r = await call("POST", `/workspaces/${ws}/graphql/introspect`, { request: { name: "x", protocol: "graphql", url: gql.http, protocol_data: {} } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.match(r.body.sdl, /type Query/);
  assert.match(r.body.sdl, /hello\(name: String = "world"\): String!/);
  assert.match(r.body.sdl, /A greeting service/);
  assert.deepEqual(r.body.roots, { query: "Query", mutation: "Mutation", subscription: "Subscription" });
  const notGql = await call("POST", `/workspaces/${ws}/graphql/introspect`, { request: { name: "x", protocol: "graphql", url: gql.http.replace("/graphql", "/nope"), protocol_data: {} } });
  assert.equal(notGql.body.ok, false);
  const refused = await call("POST", `/workspaces/${ws}/graphql/introspect`, { request: { name: "x", protocol: "graphql", url: "http://127.0.0.1:1/graphql", protocol_data: {} } });
  assert.equal(refused.body.ok, false);
  assert.match(refused.body.error, /refused|connect/i);
});

test("subscription (graphql-transport-ws): events arrive, then the stream completes", async () => {
  const r = await open({ query: "subscription S($from: Int) { countdown(from: $from) }", variables: '{"from":3}', connectionParams: '{"token":"abc"}' }, { auth: { type: "bearer", token: "ws-tok" } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const evs = await events(r.body.id);
  const inbound = evs.filter((e) => e.type === "message" && e.direction === "in").map((e) => JSON.parse(e.data).data.countdown);
  assert.deepEqual(inbound, [3, 2, 1]);
  const out = evs.find((e) => e.type === "message" && e.direction === "out");
  assert.equal(JSON.parse(out.data).variables.from, 3);
  assert.equal(evs.find((e) => e.type === "open").protocol, "graphql-transport-ws");
  assert.equal(evs.find((e) => e.type === "open").operation.type, "subscription");
  assert.ok(evs.some((e) => e.type === "completed"));
  assert.equal(evs.at(-1).type, "closed");
  assert.deepEqual(gql.seen.filter((s) => s.init).at(-1).init, { token: "abc" });
  assert.equal(gql.seen.filter((s) => s.ws).at(-1).auth, "Bearer ws-tok");
});

test("subscription: stop unsubscribes and closes; the legacy graphql-ws protocol works too", async () => {
  const a = await open({ query: "subscription { countdown(from: 1000) }" });
  const id = a.body.id;
  await events(id, (e) => e.some((x) => x.type === "message" && x.direction === "in"));
  assert.equal((await call("POST", `/workspaces/${ws}/sessions/${id}/act`, { action: "stop" })).status, 200);
  assert.equal((await events(id)).at(-1).type, "closed");
  const legacy = await open({ query: "subscription { countdown(from: 2) }", transport: "graphql-ws" });
  assert.equal(legacy.body.ok, true, JSON.stringify(legacy.body));
  const evs = await events(legacy.body.id);
  assert.deepEqual(evs.filter((e) => e.type === "message" && e.direction === "in").map((e) => JSON.parse(e.data).data.countdown), [2, 1]);
  assert.equal(evs.find((e) => e.type === "open").protocol, "graphql-ws");
});

test("subscription: separate WebSocket URL, refused connections and bad documents", async () => {
  const sep = await open({ query: "subscription { countdown(from: 1) }", wsUrl: gql.ws }, { url: "http://127.0.0.1:1/ignored" });
  assert.equal(sep.body.ok, true, JSON.stringify(sep.body));
  await call("DELETE", `/workspaces/${ws}/sessions/${sep.body.id}`);
  const rejected = await open({ query: "subscription { countdown }", connectionParams: '{"reject":true}' });
  assert.equal(rejected.body.ok, false);
  assert.match(rejected.body.error.message, /4403|Forbidden/);
  const refused = await open({ query: "subscription { countdown }" }, { url: "ws://127.0.0.1:1" });
  assert.match(refused.body.error.message, /refused/i);
  const notSub = await open({ query: "{ hello }" });
  assert.equal(notSub.body.error.phase, "validation");
  assert.match(notSub.body.error.message, /not a subscription/);
  const empty = await open({ query: "" });
  assert.match(empty.body.error.message, /Write a subscription first/);
  const badParams = await open({ query: "subscription { countdown }", connectionParams: "[1]" });
  assert.match(badParams.body.error.message, /Connection params must be a JSON object/);
});

test("the SSRF guard applies to queries and subscriptions", async () => {
  config.allowPrivateTargets = false;
  try {
    const q = await run({ query: "{ hello }" });
    assert.equal(q.body.error.phase, "network");
    assert.match(q.body.error.message, /private|internal|SSRF/i);
    const s = await open({ query: "subscription { countdown }" });
    assert.equal(s.body.ok, false);
    assert.match(s.body.error.message, /private|internal|SSRF/i);
  } finally { config.allowPrivateTargets = true; }
});

test("saved GraphQL requests keep their data and are left out of Postman exports", async () => {
  const made = await call("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "G", protocol: "graphql", method: "POST", url: gql.http, protocol_data: { query: "{ hello }", variables: "{}" } });
  assert.equal(made.status, 201);
  assert.equal((await call("GET", `/workspaces/${ws}/requests/${made.body.id}`)).body.protocol_data.query, "{ hello }");
  const exp = await call("GET", `/workspaces/${ws}/export?format=postman&collection=${col}`);
  assert.ok(exp.body.warnings.some((w) => /non-HTTP/.test(w)));
});
