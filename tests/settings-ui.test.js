// E2E: profile settings (photo, name, password) in headless Chromium. Skipped if no browser is available.
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

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("E2E: settings — photo, profile, password", { skip, timeout: 60000 }, async () => {
  const login = (username, password) => fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.fill("input[name=username]", "zed");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  // photo
  await page.locator("input[type=file]").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await page.locator("img.avatar").first().waitFor();
  await page.getByRole("button", { name: "Remove photo" }).waitFor();

  // profile
  await page.getByLabel("Display name").fill("Zed Zed");
  await page.getByLabel("Username").fill("zed2");
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator(".toast", { hasText: "Profile saved" }).waitFor();
  assert.equal((await login("zed2", "password123")).status, 200);

  // security
  await page.getByRole("tab", { name: "Security" }).click();
  await page.getByLabel("Current password").fill("password123");
  await page.getByLabel(/^New password/).fill("password456");
  await page.getByLabel("Repeat new password").fill("different999");
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByText("The two passwords don't match").waitFor();
  await page.getByLabel("Repeat new password").fill("password456");
  await page.getByRole("button", { name: "Update password" }).click();
  await page.locator(".toast", { hasText: "Password changed" }).waitFor();
  assert.equal((await login("zed2", "password123")).status, 401);
  assert.equal((await login("zed2", "password456")).status, 200);
  assert.deepEqual(errors, []);
});
