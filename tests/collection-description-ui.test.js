// E2E: writing a collection description in its settings tab, and seeing it read-only as a view-only member.
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

test("E2E: collection description — edit and save as editor, read-only as viewer", { skip, timeout: 60000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const owner = await j("POST", "/auth/register", { username: "boss", password: "password123" });
  const viewer = await j("POST", "/auth/register", { username: "watcher", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, owner.token)).id;
  await j("POST", `/workspaces/${ws}/members`, { user_ids: [viewer.user.id], role: "viewer" }, owner.token);
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Billing" }, owner.token)).id;

  const login = async (username) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(base);
    await page.fill("input[name=username]", username);
    await page.fill("input[name=password]", "password123");
    await page.getByRole("button", { name: "Sign in" }).last().click();
    await page.locator(".node", { hasText: "Billing" }).first().click();
    await page.getByRole("tab", { name: /^Description/ }).click();
    return page;
  };

  const page = await login("boss");
  const box = page.getByLabel("Collection description");
  assert.equal(await box.inputValue(), "");
  await box.fill("Invoices and payments for customers.");
  await page.getByRole("tab", { name: /^Description/ }).filter({ hasText: "●" }).waitFor(); // badge shows it has content
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator(".toast", { hasText: "Collection saved" }).waitFor();
  assert.equal((await j("GET", `/workspaces/${ws}/collections/${col}`, undefined, owner.token)).description, "Invoices and payments for customers.");

  const ro = await login("watcher");
  assert.equal(await ro.getByLabel("Collection description").inputValue(), "Invoices and payments for customers.");
  assert.equal(await ro.getByLabel("Collection description").isDisabled(), true);
  assert.equal(await ro.getByRole("button", { name: "Save" }).isDisabled(), true);
});
