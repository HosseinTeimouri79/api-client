// E2E: gRPC in the browser: a saved unary request, and a new bidirectional call built from a pasted .proto.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PROTO, startEchoServer } from "./fixtures/grpc-echo.js";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, echo, base;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  echo = await startEchoServer();
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); echo?.stop(); });

test("E2E: gRPC unary from a saved request, then a bidirectional call from a pasted .proto", { skip, timeout: 90000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "rpcfan", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "RPC" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Say hi", protocol: "grpc", url: `grpc://${echo.addr}`,
    protocol_data: { proto: PROTO, service: "demo.Echo", method: "Say", message: '{"text":"ui","n":"1"}' } }, me.token);

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "rpcfan");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "RPC" }).first().click();
  const node = page.locator(".node", { hasText: "Say hi" }).first();
  assert.equal((await node.locator(".m").textContent()).trim(), "gRPC");
  await node.click();

  // the saved request shows its service and method; the proto is parsed
  await page.getByRole("combobox", { name: "Method" }).filter({ hasText: "Say" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Metadata" }).count(), 2, "headers are called metadata for gRPC (request editor and response pane)");
  assert.equal(await page.getByRole("tab", { name: /^Params/ }).count(), 0);
  await page.getByRole("button", { name: "Invoke" }).click();
  await page.locator(".ev-in", { hasText: "hi ui" }).waitFor();
  await page.locator(".rt-state.s-closed").waitFor();
  assert.equal(await page.locator(".rt-state.bad").count(), 0, "status OK is not an error");
  await page.locator(".ev-closed", { hasText: "OK" }).waitFor();
  await page.getByRole("tab", { name: "Metadata" }).last().click();
  await page.getByText("x-trailer").waitFor();
  await page.getByRole("tab", { name: /^Messages/ }).click();

  // a failing call is shown as an error
  await page.getByRole("combobox", { name: "Method" }).click();
  await page.locator(".opt", { hasText: "Fail" }).click();
  await page.getByRole("button", { name: "Invoke" }).click();
  await page.locator(".rt-state.s-closed.bad").waitFor();
  await page.getByText("NOT_FOUND: nope").first().waitFor();

  // new request: pick gRPC, paste a proto, choose a bidirectional method
  await page.getByRole("button", { name: "New request" }).first().click().catch(() => {});
  await page.keyboard.press("Control+t");
  await page.getByRole("combobox", { name: "Protocol" }).click();
  await page.locator(".opt", { hasText: /^gRPC/ }).click();
  await page.getByLabel("URL", { exact: true }).fill(`${echo.addr}`);
  await page.getByRole("tab", { name: "Proto" }).click();
  await page.getByLabel("Proto", { exact: true }).fill(PROTO);
  await page.getByText("Found 1 service(s) with 6 method(s)").waitFor();
  await page.getByRole("tab", { name: "Message", exact: true }).click();
  await page.getByRole("combobox", { name: "Method" }).filter({ hasText: "Say" }).waitFor(); // first method is preselected
  assert.match(await page.locator("textarea.ws-compose").inputValue(), /"text": ""/, "an example message is inserted");
  await page.getByRole("combobox", { name: "Method" }).click();
  await page.locator(".opt", { hasText: "Chat" }).click();
  await page.getByRole("button", { name: "Invoke" }).click();
  await page.locator(".rt-state.s-open").waitFor();
  await page.locator("textarea.ws-compose").fill('{"text":"ping"}');
  await page.getByRole("button", { name: "Send message" }).click();
  await page.locator(".ev-in", { hasText: "echo ping" }).waitFor();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.getByRole("button", { name: "End stream" }).click();
  await page.locator(".rt-state.s-closed").waitFor();
  assert.equal(await page.locator(".rt-state.bad").count(), 0);
  assert.deepEqual(errors, []);
});
