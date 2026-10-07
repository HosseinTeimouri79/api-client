// E2E: an event stream in the browser: start, read events (names, ids, multi-line data), stop, POST variant, reconnect option.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startSseServer } from "./fixtures/sse-server.js";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, sse, base;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  sse = await startSseServer();
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); sse?.stop(); });

test("E2E: SSE stream, stop, POST body and reconnect", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "streamer", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Streams" }, me.token)).id;
  const mk = (name, url, extra = {}) => j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name, protocol: "sse", url, ...extra }, me.token);
  await mk("Ticks", sse.base + "/stream");
  await mk("Forever", sse.base + "/forever");
  await mk("Chat", sse.base + "/echo", { method: "POST", body: { mode: "json", content: '{"prompt":"hello"}' } });
  await mk("Resume", sse.base + "/resume", { protocol_data: { reconnect: true, maxReconnects: 1 } });

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "streamer");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Streams" }).first().click();
  const open = async (name) => page.locator(".node", { hasText: name }).first().click();

  await open("Ticks");
  assert.equal((await page.locator(".node", { hasText: "Ticks" }).locator(".m").textContent()).trim(), "SSE");
  assert.equal(await page.getByRole("combobox", { name: "Method" }).textContent().then((t) => t.trim()), "GET");
  await page.getByRole("button", { name: "Stream", exact: true }).click();
  await page.locator(".ev-in", { hasText: "split across chunks" }).waitFor();
  assert.equal(await page.locator(".ev-in").count(), 5);
  await page.locator(".ev-in", { hasText: "first" }).locator(".ev-badge", { hasText: "tick" }).waitFor(); // the event name
  await page.locator(".ev-comment").waitFor();
  await page.locator(".rt-state.s-closed").waitFor(); // the server ended the stream
  await page.getByRole("tab", { name: "Response" }).click();
  await page.getByText("text/event-stream").first().waitFor();
  await page.getByRole("tab", { name: /^Messages/ }).click();

  // a stream that never ends can be stopped
  await open("Forever");
  await page.getByRole("button", { name: "Stream", exact: true }).click();
  await page.locator(".rt-state.s-open").waitFor();
  await page.locator(".ev-in").nth(2).waitFor();
  await page.getByRole("button", { name: "Stop" }).click();
  await page.locator(".rt-state.s-closed").waitFor();

  // POST with a body: the body tab is there, the echo shows what the server received
  await open("Chat");
  await page.getByRole("tab", { name: /^Body/ }).waitFor();
  await page.getByRole("button", { name: "Stream", exact: true }).click();
  await page.locator(".ev-in", { hasText: "hello" }).waitFor();
  await page.locator(".ev-in .ev-badge", { hasText: "echo" }).waitFor();
  // GET requests have no body tab
  await page.getByRole("combobox", { name: "Method" }).click();
  await page.locator(".opt", { hasText: /^GET/ }).click();
  assert.equal(await page.getByRole("tab", { name: /^Body/ }).count(), 0);
  assert.equal(await page.locator(".opt", { hasText: /^DELETE/ }).count(), 0, "only GET and POST are offered");

  // reconnect: two connections, resumed with the last event id
  sse.resetReconnects();
  await open("Resume");
  await page.getByRole("tab", { name: "Settings" }).click();
  assert.equal(await page.getByLabel("Reconnect when the server ends the stream").isChecked(), true);
  await page.getByRole("button", { name: "Stream", exact: true }).click();
  await page.locator(".ev-in", { hasText: "resumed from 5" }).waitFor();
  await page.locator(".ev-reconnecting").waitFor();
  assert.deepEqual(errors, []);
});
