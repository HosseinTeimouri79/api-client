// E2E: UDP in the browser: open a socket, send a datagram, read the answer, change to listening.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import dgram from "node:dgram";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, echo, base, config;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  ({ config } = await import("../src/config.js"));
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  echo = dgram.createSocket("udp4");
  echo.on("message", (m, r) => echo.send(Buffer.concat([Buffer.from("echo:"), m]), r.port, r.address));
  await new Promise((r) => echo.bind(0, "127.0.0.1", r));
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { if (config) config.udpListenPorts = []; await browser?.close(); server?.close(); echo?.close(); });

test("E2E: UDP send and receive, then listening on an allowed port", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "udpfan", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Datagrams" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Pinger", protocol: "udp", url: `udp://127.0.0.1:${echo.address().port}`, protocol_data: { message: "ping" } }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "udpfan");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Datagrams" }).first().click();
  const node = page.locator(".node", { hasText: "Pinger" }).first();
  assert.equal((await node.locator(".m").textContent()).trim(), "UDP");
  await node.click();

  await page.getByRole("button", { name: "Open socket" }).click();
  await page.locator(".rt-state.s-open").waitFor();
  await page.locator("textarea.ws-compose").focus();
  await page.keyboard.press("Control+Enter");
  const answer = page.locator(".ev-in", { hasText: "echo:ping" });
  await answer.waitFor();
  await answer.locator(".ev-badge.peer", { hasText: `127.0.0.1:${echo.address().port}` }).waitFor();
  await page.getByRole("tab", { name: "Connection" }).click();
  await page.getByText("Local address").waitFor();
  await page.getByRole("tab", { name: /^Messages/ }).click();
  await page.getByRole("button", { name: "Close socket" }).click();
  await page.locator(".rt-state.s-closed").waitFor();

  // listening: refused while the administrator has not allowed a port, works on an allowed one
  await page.getByRole("tab", { name: /^Settings/ }).click();
  await page.getByRole("combobox", { name: "Mode" }).click();
  await page.locator(".opt", { hasText: "Listen on a local port" }).click();
  await page.getByLabel("Local port to listen on").fill("45678");
  await page.getByRole("button", { name: "Open socket" }).click();
  await page.locator(".rt-state.s-failed").waitFor();
  await page.getByText(/turned off on this server/).first().waitFor();
  config.udpListenPorts = [[45678, 45678]];
  await page.getByRole("button", { name: "Open socket" }).click();
  await page.locator(".rt-state.s-open").waitFor();
  const sender = dgram.createSocket("udp4");
  sender.send("hello server", 45678, "127.0.0.1");
  await page.locator(".ev-in", { hasText: "hello server" }).waitFor();
  sender.close();
  await page.getByRole("button", { name: "Close socket" }).click();
  await page.locator(".rt-state.s-closed").waitFor();
  assert.deepEqual(errors, []);
});
