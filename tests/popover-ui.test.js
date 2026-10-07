// E2E: a popover opened from a hover-only button must not jump when the pointer moves into it.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

test("E2E: sidebar actions menu keeps its position while hovering its items", { skip, timeout: 60000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const u = await j("POST", "/auth/register", { username: "dev", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "W" }, u.token)).id;
  await j("POST", `/workspaces/${ws}/collections`, { name: "Billing" }, u.token);
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await page.goto(base);
  await page.fill("input[name=username]", "dev");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  const node = page.locator(".node", { hasText: "Billing" }).first();
  await node.hover();
  await node.getByLabel("Actions").click();
  const menu = page.locator(".popover .menu-in");
  await menu.waitFor();
  const items = menu.getByRole("menuitem");
  assert.ok((await page.locator(".popover").boundingBox()).x > 100, "opens next to its button, not in the corner");

  // the pointer leaves the row, which hides the row's buttons (display:none) while the menu stays open
  await items.nth(0).hover();
  await page.waitForTimeout(150);
  assert.equal(await node.getByLabel("Actions").isVisible(), false, "the anchor button is hidden while the pointer is in the menu");
  const settled = await page.locator(".popover").boundingBox();
  assert.ok(settled.x > 100 && settled.y > 100, `menu flew to the corner: ${JSON.stringify(settled)}`);
  for (let i = 0; i < Math.min(5, await items.count()); i++) {
    await items.nth(i).hover();
    await page.waitForTimeout(50);
    const now = await page.locator(".popover").boundingBox();
    assert.deepEqual([now.x, now.y], [settled.x, settled.y], `menu moved when hovering item ${i}`);
  }
});
