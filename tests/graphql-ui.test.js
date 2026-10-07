// E2E: GraphQL in the browser: send a query, see the schema, switch to a subscription, get the code snippet.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startGraphqlServer } from "./fixtures/graphql-server.js";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, gql, base;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  gql = await startGraphqlServer();
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); gql?.stop(); });

test("E2E: GraphQL query, schema, snippet and subscription", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "gqlfan", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Graph" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Hello", protocol: "graphql", method: "POST", url: gql.http,
    protocol_data: { query: "query Hi($n: String) { hello(name: $n) }", variables: '{"n":"ui"}' } }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "gqlfan");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Graph" }).first().click();
  const node = page.locator(".node", { hasText: "Hello" }).first();
  assert.equal((await node.locator(".m").textContent()).trim(), "GQL");
  await node.click();

  // no method picker; the document is analysed (a Query badge appears)
  assert.equal(await page.locator(".method-select").count(), 0);
  await page.locator(".gql-type", { hasText: "Query" }).waitFor();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText('"hello ui"').first().waitFor();

  // the snippet is the HTTP request that carries the query
  await page.getByRole("button", { name: "Code" }).click();
  const snippet = await page.locator("pre.snippet").textContent();
  assert.match(snippet, /curl/);
  assert.match(snippet, /query Hi/);
  assert.match(snippet, /"variables"/);
  await page.keyboard.press("Escape");

  // several operations: the picker asks which one to run
  await page.locator("textarea.gql-query").fill("query A { hello } query B { me }");
  await page.getByRole("combobox", { name: "Operation" }).waitFor();
  await page.getByText("The document has several operations").waitFor();
  await page.getByRole("combobox", { name: "Operation" }).click();
  await page.locator(".opt", { hasText: /^A/ }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText('"hello world"').first().waitFor();

  // a syntax error is shown under the editor, with its position
  await page.locator("textarea.gql-query").fill("query { hello ");
  await page.locator(".note.err", { hasText: "line 1" }).waitFor();

  // schema by introspection
  await page.getByRole("tab", { name: "Schema" }).click();
  await page.getByRole("button", { name: "Fetch schema" }).click();
  await page.locator("pre.gql-sdl").waitFor();
  assert.match(await page.locator("pre.gql-sdl").textContent(), /hello\(name: String = "world"\): String!/);
  await page.getByLabel("Filter types and fields").fill("countdown");
  assert.doesNotMatch(await page.locator("pre.gql-sdl").textContent(), /type Mutation/);
  assert.match(await page.locator("pre.gql-sdl").textContent(), /type Subscription/);

  // a subscription turns Send into Subscribe and opens a live log
  await page.getByRole("tab", { name: /^Query/ }).click();
  await page.locator("textarea.gql-query").fill("subscription { countdown(from: 3) }");
  await page.locator(".gql-type", { hasText: "Subscription" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Code" }).count(), 0, "no code snippet for a connection");
  await page.getByRole("button", { name: "Subscribe" }).click();
  await page.locator(".ev-in", { hasText: '"countdown": 1' }).waitFor();
  await page.locator(".ev-completed").waitFor();
  await page.locator(".rt-state.s-closed").waitFor();
  assert.equal(await page.locator(".ev-in").count(), 3);

  // back to a query: the normal response viewer returns
  await page.locator("textarea.gql-query").fill("{ hello }");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText('"hello world"').first().waitFor();
  assert.deepEqual(errors, []);
});
