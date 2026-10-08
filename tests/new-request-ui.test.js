// E2E: new requests are started from a popover that lists the protocols (no name prompt); the sidebar "+" menu also offers a new collection.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PROTOCOLS } from "../src/protocols/index.js";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, base;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); });

test("E2E: new request from the collection popover, and from the sidebar + menu", { skip, timeout: 60000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "starter", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections`, { name: "Things" }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "starter");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();

  // a collection's "new request" button opens a popover with every protocol, and creates the request at once
  const row = page.locator(".node", { hasText: "Things" }).first();
  await row.hover();
  await row.getByRole("button", { name: "New", exact: true }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  // one "+" on a collection: a sub-collection, then a request of any protocol (the same menu as the sidebar "+")
  assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts().then((l) => l.map((x) => x.trim())), ["New sub-collection", "New request", ...PROTOCOLS.map((p) => ({ http: "HTTP", websocket: "WebSocket", grpc: "gRPC", graphql: "GraphQL", sse: "SSE", tcp: "TCP", udp: "UDP", mqtt: "MQTT", amqp: "AMQP" })[p])]);
  await menu.getByRole("menuitem", { name: "WebSocket" }).click();
  assert.equal(await page.getByRole("dialog").count(), 0, "no modal asks for a name");
  await page.getByRole("combobox", { name: "Protocol" }).filter({ hasText: "WebSocket" }).waitFor();
  const made = page.locator(".node", { hasText: "New Request" }).first();
  await made.waitFor();
  assert.equal((await made.locator(".m").textContent()).trim(), "WS");

  assert.equal(await row.getByRole("button", { name: "New sub-collection" }).count(), 0, "no separate sub-collection button");
  // the sidebar "+" offers a new collection and the same protocols; a request made there is not saved yet
  await page.getByRole("button", { name: "New", exact: true }).click();
  const top = page.getByRole("menu");
  await top.getByRole("menuitem", { name: "New collection" }).waitFor();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await top.getByRole("menuitem", { name: "gRPC" }).click();
  await page.getByRole("combobox", { name: "Protocol" }).filter({ hasText: "gRPC" }).waitFor();
  assert.equal(await page.locator(".tab.on .dirty").count(), 0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New collection" }).click();
  await page.getByRole("dialog").waitFor(); // a collection still needs a name
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
});
