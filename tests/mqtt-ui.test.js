// E2E: MQTT in the browser: connect, subscribe, receive, publish, unsubscribe, disconnect.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mqtt from "mqtt";
import { startBroker } from "./fixtures/mqtt-broker.js";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, broker, watcher, base;
const heard = [];

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  broker = await startBroker();
  watcher = await mqtt.connectAsync(broker.tcp, { username: "user", password: "pw" });
  watcher.on("message", (topic, payload, p) => heard.push({ topic, text: payload.toString(), qos: p.qos, retain: p.retain }));
  await watcher.subscribeAsync("ui/#", { qos: 1 });
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); await watcher?.endAsync(true); await broker?.stop(); });

test("E2E: MQTT connect, subscribe, receive, publish, unsubscribe and a graceful disconnect", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "mqttfan", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Brokers" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Local", protocol: "mqtt", url: broker.tcp,
    protocol_data: { username: "user", password: "pw", clientId: "ui-client", topic: "ui/state", payload: "on", qos: 1, willTopic: "ui/will", willPayload: "ui gone" } }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "mqttfan");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Brokers" }).first().click();
  const node = page.locator(".node", { hasText: "Local" }).first();
  assert.equal((await node.locator(".m").textContent()).trim(), "MQTT");
  await node.click();

  // publishing needs a connection
  assert.equal(await page.getByRole("button", { name: "Publish", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.locator(".rt-state.s-open").waitFor();
  await page.getByRole("tab", { name: "Connection" }).click();
  await page.getByText("ui-client").first().waitFor();
  await page.getByRole("tab", { name: /^Messages/ }).click();

  // subscribe with a wildcard; an outside client publishes
  await page.getByRole("tab", { name: /^Subscribe/ }).click();
  await page.getByLabel("Topic filter").fill("ui/in/#");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await page.locator("table.htable th", { hasText: "ui/in/#" }).waitFor();
  watcher.publish("ui/in/temp", "21.5", { qos: 0, retain: false });
  const got = page.locator(".ev-in", { hasText: "21.5" });
  await got.waitFor();
  await got.locator(".ev-badge", { hasText: "ui/in/temp" }).waitFor();

  // publish from the UI, Ctrl+Enter in the payload
  await page.getByRole("tab", { name: /^Publish/ }).click();
  await page.locator("textarea.ws-compose").focus();
  await page.keyboard.press("Control+Enter");
  await page.locator(".ev-out", { hasText: "on" }).waitFor();
  for (let i = 0; i < 50 && !heard.some((h) => h.topic === "ui/state"); i++) await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(heard.find((h) => h.topic === "ui/state"), { topic: "ui/state", text: "on", qos: 1, retain: false });

  // unsubscribe from the list
  await page.getByRole("tab", { name: /^Subscribe/ }).click();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await page.getByText("Not subscribed to anything yet.").waitFor();

  // Disconnect is graceful: the broker does not publish the last will
  heard.length = 0;
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.locator(".rt-state.s-closed").waitFor();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!heard.some((h) => h.topic === "ui/will"), "DISCONNECT was sent, so no will");
  assert.deepEqual(errors, []);
});
