// E2E: a WebSocket request in the browser: connect, send a message, ping, see the log, disconnect, change protocol.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WebSocketServer } from "ws";
import { PROTOCOLS, IMPLEMENTED } from "../src/protocols/index.js";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, wss, base, wsUrl, app;
const got = [];

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  app = createApp(openDb(":memory:"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (s) => {
    s.on("message", (d) => { got.push(String(d)); s.send(`echo:${d}`); });
    s.on("ping", (d) => got.push("ping:" + d));
  });
  await new Promise((r) => wss.on("listening", r));
  wsUrl = `ws://127.0.0.1:${wss.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); for (const c of wss?.clients ?? []) c.terminate(); wss?.close(); server?.close(); });

test("E2E: WebSocket request: connect, send, ping, disconnect, and the connection ends with the tab", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "socketeer", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Live" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Echo", protocol: "websocket", url: wsUrl, protocol_data: { message: "hello from ui" } }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "socketeer");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Live" }).first().click();
  const node = page.locator(".node", { hasText: "Echo" }).first();
  assert.equal((await node.locator(".m").textContent()).trim(), "WS", "the tree shows the protocol, not a method");
  await node.click();

  // WebSocket requests have no method picker and no code snippet; the button says Connect
  assert.equal(await page.locator(".method-select").count(), 0);
  assert.equal(await page.getByRole("button", { name: /Code/ }).count(), 0);
  assert.equal((await page.getByRole("combobox", { name: "Protocol" }).textContent()).trim(), "WebSocket");
  await page.getByText("Not connected").waitFor();
  assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true, "nothing to send before connecting");

  await page.getByRole("button", { name: "Connect" }).click();
  await page.locator(".rt-state.s-open").waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Protocol" }).isDisabled(), true, "protocol is locked while connected");

  // the saved draft is in the composer; Ctrl+Enter sends it, and the echo arrives
  assert.equal(await page.locator("textarea.ws-compose").inputValue(), "hello from ui");
  await page.locator("textarea.ws-compose").focus();
  await page.keyboard.press("Control+Enter");
  await page.locator(".ev-in", { hasText: "echo:hello from ui" }).waitFor();
  assert.equal(await page.locator(".ev-out", { hasText: "hello from ui" }).count(), 1);
  assert.deepEqual(got, ["hello from ui"]);

  // ping with a payload, then filter the log
  await page.getByLabel("Ping / pong payload (optional)").fill("beat");
  await page.getByRole("button", { name: "Ping", exact: true }).click();
  await page.locator(".ev-ping.ev-out").waitFor();
  await page.locator(".ev-pong.ev-in", { hasText: "beat" }).waitFor();
  assert.ok(got.includes("ping:beat"));
  await page.getByRole("tab", { name: "Sent" }).click();
  assert.equal(await page.locator(".ev-in").count(), 0);
  assert.ok((await page.locator(".ev-out").count()) >= 2);
  await page.getByRole("tab", { name: "Events" }).click();
  await page.locator(".ev-open").waitFor();
  await page.getByRole("tab", { name: "All" }).click();

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // a clicked message opens its detail with a copy button
  await page.locator(".ev-in", { hasText: "echo:hello from ui" }).locator(".ev-row").click();
  await page.locator(".ev-detail").getByRole("button", { name: "Copy" }).waitFor();

  // handshake tab lists the response headers
  await page.getByRole("tab", { name: "Handshake" }).click();
  await page.getByText("upgrade", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /^Messages/ }).click();

  await page.getByRole("button", { name: "Clear" }).click();
  assert.equal(await page.locator(".ev").count(), 0);

  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.locator(".rt-state.s-closed").waitFor();
  await page.getByRole("button", { name: "Connect" }).waitFor();

  // the protocol list: unfinished protocols are visible but cannot be picked
  await page.getByRole("combobox", { name: "Protocol" }).click();
  const soon = page.locator(".opt.disabled");
  assert.equal(await soon.count(), PROTOCOLS.length - IMPLEMENTED.length);
  await soon.first().click({ force: true });
  assert.equal((await page.getByRole("combobox", { name: "Protocol" }).textContent()).trim(), "WebSocket");
  await page.locator(".opt", { hasText: /^HTTP/ }).click();
  await page.locator(".method-select").waitFor();
  assert.equal(await page.getByRole("button", { name: "Connect" }).count(), 0);

  // connect again, then close the tab: the server drops the session
  await page.getByRole("combobox", { name: "Protocol" }).click();
  await page.locator(".opt", { hasText: /^WebSocket/ }).click();
  await page.getByRole("button", { name: "Connect" }).click();
  await page.locator(".rt-state.s-open").waitFor();
  const sessions = app.locals.sessions;
  assert.equal([...sessions.sessions.values()].filter((s) => !s.closed).length, 1);
  await page.locator(".tab.on .tab-x").click();
  await page.getByRole("button", { name: "Discard" }).click(); // switching protocols left unsaved changes
  for (let i = 0; i < 40 && [...sessions.sessions.values()].some((s) => !s.closed); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal([...sessions.sessions.values()].filter((s) => !s.closed).length, 0, "closing the tab ends the connection");
  assert.deepEqual(errors, []);
});
