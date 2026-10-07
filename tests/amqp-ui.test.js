// E2E: AMQP in the browser: connect, consume with a declared and bound queue, publish, ack / requeue / discard from the log.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startAmqpBroker } from "./fixtures/amqp-broker.js";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, broker, base;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  broker = await startAmqpBroker();
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); server?.close(); broker?.stop(); });

test("E2E: AMQP consume, publish, ack, requeue and discard", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "rabbit", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Brokers" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Orders", protocol: "amqp", url: broker.url,
    protocol_data: { queue: "orders", bindExchange: "shop", bindKey: "order.#", exchangeType: "topic", exchange: "shop", routingKey: "order.new", payload: '{"id":1}', contentType: "application/json" } }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "rabbit");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Brokers" }).first().click();
  const node = page.locator(".node", { hasText: "Orders" }).first();
  assert.equal((await node.locator(".m").textContent()).trim(), "AMQP");
  await node.click();

  await page.getByRole("button", { name: "Connect" }).click();
  await page.locator(".rt-state.s-open").waitFor();
  await page.getByRole("tab", { name: "Connection" }).click();
  await page.getByText("MiniBroker 1.0").waitFor();
  await page.getByRole("tab", { name: /^Messages/ }).click();

  // declare + bind + consume from the saved settings
  await page.getByRole("tab", { name: /^Consume/ }).click();
  await page.getByRole("button", { name: "Consume", exact: true }).click();
  await page.locator("table.htable th", { hasText: "orders" }).waitFor();
  await page.locator(".ev-queue").waitFor();
  await page.locator(".ev-bound").waitFor();

  // publish with Ctrl+Enter; it comes back through the binding
  await page.getByRole("tab", { name: /^Publish/ }).click();
  await page.locator("textarea.ws-compose").focus();
  await page.keyboard.press("Control+Enter");
  const delivery = page.locator(".ev-in", { hasText: '"id":1' });
  await delivery.waitFor();
  await delivery.locator(".ev-badge", { hasText: "order.new" }).waitFor();
  await delivery.locator(".ev-badge", { hasText: "shop" }).waitFor();
  await delivery.getByRole("button", { name: "Requeue", exact: true }).click();
  const again = page.locator(".ev-in", { hasText: "redelivered" });
  await again.waitFor();
  await again.getByRole("button", { name: "Ack", exact: true }).click();
  await page.locator(".ev-acked").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".ev-in .ev-acts").length === 0);

  // discard another one
  await page.locator("textarea.ws-compose").focus();
  await page.keyboard.press("Control+Enter");
  const third = page.locator(".ev-in", { has: page.getByRole("button", { name: "Discard", exact: true }) });
  await third.waitFor();
  await third.getByRole("button", { name: "Discard", exact: true }).click();
  await page.locator(".ev-rejected", { hasText: "discarded" }).waitFor();

  // ack all pending
  await page.locator("textarea.ws-compose").focus();
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await page.getByRole("tab", { name: /^Consume/ }).click();
  await page.getByText(/2 message\(s\) waiting for an acknowledgement/).waitFor();
  await page.getByRole("button", { name: "Acknowledge all" }).click();
  await page.getByText(/waiting for an acknowledgement/).waitFor({ state: "detached" });

  // cancel the consumer, then disconnect
  await page.getByRole("button", { name: "Cancel consumer" }).click();
  await page.getByText("Not consuming from any queue yet.").waitFor();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.locator(".rt-state.s-closed").waitFor();
  assert.deepEqual(errors, []);
});
