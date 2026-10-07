// E2E: admin panel in headless Chromium. Skipped if no browser is available (set CHROME_PATH).
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
after(async () => {
  await browser?.close();
  server?.close();
});

test("E2E: admin creates a user, resets their password and disables them", { skip, timeout: 60000 }, async () => {
  const post = (path, body) => fetch(base + "/api" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.fill("input[name=username]", "boss");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Admin panel" }).click();
  await page.getByRole("heading", { name: "Admin panel" }).waitFor();

  // create
  await page.getByRole("button", { name: "New user" }).click();
  await page.locator("#user-form input").nth(0).fill("newbie");
  await page.locator("#user-form input").nth(2).fill("first-pass-1");
  await page.getByRole("button", { name: "Create user" }).click();
  const row = page.locator("tr", { hasText: "@newbie" });
  await row.waitFor();
  assert.equal((await post("/auth/login", { username: "newbie", password: "first-pass-1" })).status, 200);

  // reset password
  await row.getByLabel("Reset password").click();
  await page.locator("#pw-form input").first().fill("second-pass-2");
  await page.getByRole("button", { name: "Set password", exact: true }).click();
  await page.locator(".toast", { hasText: "Password changed" }).waitFor();
  assert.equal((await post("/auth/login", { username: "newbie", password: "first-pass-1" })).status, 401);
  assert.equal((await post("/auth/login", { username: "newbie", password: "second-pass-2" })).status, 200);

  // own row can't be disabled/deleted
  assert.ok(await page.locator("tr", { hasText: "@boss" }).getByLabel("Delete user").isDisabled());

  // disable
  await row.getByLabel("Disable account").click();
  await page.locator(".modal").getByRole("button", { name: "Disable", exact: true }).click();
  await row.getByText("disabled").waitFor();
  assert.equal((await post("/auth/login", { username: "newbie", password: "second-pass-2" })).status, 403);

  // activity + back
  await page.getByRole("tab", { name: "Activity" }).click();
  await page.getByText("reset password of").waitFor();
  // close self-registration: the sign-in screen then offers no "Create account"
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: "Allow self-registration" }).uncheck();
  await page.locator(".toast", { hasText: "Saved" }).waitFor();
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(base);
  await anon.getByRole("button", { name: "Sign in" }).last().waitFor();
  await anon.getByText("New accounts are created by an administrator").waitFor();
  assert.equal(await anon.getByRole("tab", { name: "Create account" }).count(), 0);
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.getByRole("heading", { name: "Welcome" }).waitFor();
  assert.deepEqual(errors, []);
});
