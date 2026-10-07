// E2E: a TCP connection in the browser: connect, banner, send text and hex, binary reply with a hex dump, close.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, tcp, base;
const got = [];

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tcp = net.createServer((s) => {
    s.setNoDelay(true);
    s.write("220 ready\r\n");
    s.on("data", (d) => { got.push(d.toString("hex")); s.write(d.toString().startsWith("bin") ? Buffer.from([0x41, 0, 0xff, 0x42]) : "echo:" + d); });
    s.on("error", () => {});
  }).listen(0, "127.0.0.1");
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); tcp?.close(); });

test("E2E: TCP connect, send text with a line ending, send hex, read a binary reply", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "socketfan", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Sockets" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Raw", protocol: "tcp", url: `tcp://127.0.0.1:${tcp.address().port}`, protocol_data: { message: "HELO", lineEnding: "crlf" } }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "socketfan");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Sockets" }).first().click();
  const node = page.locator(".node", { hasText: "Raw" }).first();
  assert.equal((await node.locator(".m").textContent()).trim(), "TCP");
  await node.click();

  // no headers, params or auth for a raw socket
  assert.equal(await page.getByRole("tab", { name: /^Headers/ }).count(), 0);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.locator(".ev-in", { hasText: "220 ready" }).waitFor();
  await page.locator("textarea.ws-compose").focus();
  await page.keyboard.press("Control+Enter");
  await page.locator(".ev-in", { hasText: "echo:HELO" }).waitFor();
  assert.ok(got.includes(Buffer.from("HELO\r\n").toString("hex")), "the CRLF was appended");

  // hex in, binary out with a hex dump
  await page.getByRole("combobox", { name: "Format" }).click();
  await page.locator(".opt", { hasText: "Binary (hex)" }).click();
  assert.equal(await page.getByRole("combobox", { name: "Line ending added to text messages" }).count(), 0, "line endings only apply to text");
  await page.locator("textarea.ws-compose").fill("62 69 6e");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const reply = page.locator(".ev-in", { has: page.locator(".ev-badge.bin") });
  await reply.waitFor();
  await reply.locator(".ev-row").click();
  await page.getByText("Hex dump").waitFor();
  assert.match(await reply.locator("pre").last().textContent(), /00000000 {2}41 00 ff 42 {30,}A\.\.B/);

  // the connection details tab
  await page.getByRole("tab", { name: "Connection" }).click();
  await page.getByText("Remote address").waitFor();
  await page.getByRole("tab", { name: /^Messages/ }).click();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.locator(".rt-state.s-closed").waitFor();
  assert.deepEqual(errors, []);
});
