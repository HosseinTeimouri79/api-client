// E2E: drives the real UI in headless Chromium. Skipped if no browser is available (set CHROME_PATH).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((p) => fs.existsSync(p));
const skip = !CHROME && "no Chromium found (set CHROME_PATH)";
let browser, server, target, base, tbase;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  target = http
    .createServer((_q, r) => {
      r.setHeader("content-type", "application/json");
      r.end('{"hello":"world","items":[1,2,3]}');
    })
    .listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
  server?.close();
  target?.close();
});

test(
  "E2E: login → workspace → collection → request → run → save → add member → change role",
  { skip, timeout: 60000 },
  async () => {
    // second user registered via API so it can be invited
    await fetch(base + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Sara",
        email: "sara@t.io",
        password: "password123",
      }),
    });
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByText("Need an account? Register").click();
    await page.fill("input[name=name]", "Hossein");
    await page.fill("input[name=email]", "h@t.io");
    await page.fill("input[name=password]", "password123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("button", { name: "New workspace" }).click();
    await page.locator(".modal input").fill("Backend Team");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByTitle("New collection").click();
    await page.locator(".modal input").fill("Users API");
    await page.getByRole("button", { name: "OK" }).click();
    await page.locator(".node", { hasText: "Users API" }).hover();
    await page
      .locator(".node", { hasText: "Users API" })
      .getByTitle("Actions")
      .click();
    await page
      .locator(".ctx")
      .getByText("New request", { exact: true })
      .click();
    await page.locator(".modal input").fill("Get hello");
    await page.getByRole("button", { name: "OK" }).click();
    await page
      .locator('.urlbar input[placeholder^="https"]')
      .fill(`${tbase}/hello?x=1`);
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: /^Params/ }).click();
    assert.equal(
      await page.locator(".kv input[type=text]").first().inputValue(),
      "x",
      "query string moved into Params table",
    );
    await page.getByRole("button", { name: "Send" }).click();
    await page.locator(".pill", { hasText: "200 OK" }).waitFor();
    await page.locator(".jt", { hasText: "hello" }).waitFor();
    assert.ok(
      await page
        .locator(".log")
        .innerText()
        .then((t) => /Response received: 200/.test(t)),
      "console shows response log",
    );
    await page.getByRole("button", { name: "Raw" }).click();
    await page.locator(".raw", { hasText: '{"hello"' }).waitFor();
    // pre/post scripts + tests
    await page.getByRole("button", { name: "Post-request" }).click();
    await page
      .locator(".code textarea")
      .fill(
        'test("hello is world", () => expect(response.json().hello).toBe("world"))',
      );
    await page.keyboard.press("Control+Enter");
    await page.getByRole("button", { name: "Tests 1/1" }).click();
    await page.locator(".scroll", { hasText: "PASS" }).waitFor();
    await page.keyboard.press("Control+s");
    await page.getByText("Saved").first().waitFor();
    // members
    await page.getByRole("button", { name: "Members" }).click();
    await page.locator(".modal input[type=email]").fill("sara@t.io");
    await page.getByRole("button", { name: "Invite" }).click();
    await page
      .locator(".modal", { hasText: "Sara" })
      .locator("select")
      .first()
      .waitFor();
    const row = page.locator(".modal .row", { hasText: "Sara" });
    await row.locator("select").selectOption("editor");
    await page.getByText("Role updated").waitFor();
    const members = await page.evaluate(() =>
      fetch("/api/workspaces")
        .then((r) => r.json())
        .then((w) =>
          fetch(`/api/workspaces/${w[0].id}/members`, { headers: {} }).then(
            (r) => r.json(),
          ),
        ),
    );
    assert.equal(members.find((m) => m.name === "Sara").role, "editor");
    assert.deepEqual(errors, [], "no uncaught page errors");
    // viewer UI hides writes
    const p2 = await (await browser.newContext()).newPage();
    await p2.goto(base);
    await p2.fill("input[name=email]", "sara@t.io");
    await p2.fill("input[name=password]", "password123");
    await p2.getByRole("button", { name: "Sign in" }).click();
    await p2.locator(".node", { hasText: "Users API" }).waitFor();
  },
);
