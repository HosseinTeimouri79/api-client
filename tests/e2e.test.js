// E2E: drives the real React UI in headless Chromium. Skipped if no browser is available (set CHROME_PATH).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
process.env.ALLOW_PRIVATE_TARGETS = "true";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, target, base, tbase;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  target = http
    .createServer((q, r) => {
      let b = "";
      q.on("data", (c) => (b += c));
      q.on("end", () => {
        r.setHeader("content-type", "application/json");
        r.end(JSON.stringify({ hello: "world", echo: b, items: [1, 2, 3] }));
      });
    })
    .listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  server?.close();
  target?.close();
});

test("E2E: username login → workspace → request with pre/post scripts → save → add members via picker → role change", { skip, timeout: 90000 }, async () => {
  // other users exist so the picker has people to offer
  for (const [username, name] of [["sara", "Sara Lee"], ["ali", "Ali Reza"], ["mona", "Mona K"]])
    await fetch(base + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, name, password: "password123" }) });
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  // --- username + password only (no email field) ---
  assert.equal(await page.locator("input[type=email]").count(), 0, "no email field");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.fill("input[name=username]", "hossein");
  await page.fill("input[name=name]", "Hossein");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.locator(".modal input").fill("Backend Team");
  await page.getByRole("button", { name: "Create" }).click();
  // an empty workspace offers Import next to New collection
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator(".modal").getByRole("tab", { name: "Import" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".modal").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "New collection" }).first().click();
  await page.locator(".modal input").fill("Users API");
  await page.getByRole("button", { name: "Create" }).click();
  await page.locator(".node", { hasText: "Users API" }).hover();
  await page.locator(".node", { hasText: "Users API" }).getByLabel("New request").click();
  await page.locator(".modal input").fill("Get hello");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByLabel("Method").click();
  await page.getByRole("option", { name: "POST" }).click();
  await page.getByLabel("URL", { exact: true }).fill(`${tbase}/hello?x=1`);
  await page.keyboard.press("Tab");
  await page.getByRole("tab", { name: /^Params/ }).click();
  assert.equal(await page.locator('.kv input[aria-label="Key"]').first().inputValue(), "x", "query string moved into Params table");

  // the Description tab is marked once it has text, like the other tabs
  const docsTab = page.getByRole("tab", { name: /^Description/ });
  assert.equal(await docsTab.locator(".count").count(), 0);
  await docsTab.click();
  await page.locator("textarea.docs").fill("Returns the greeting.");
  assert.equal(await docsTab.locator(".count").textContent(), "●");
  await page.locator("textarea.docs").fill("   ");
  assert.equal(await docsTab.locator(".count").count(), 0, "whitespace only does not count");
  await page.locator("textarea.docs").fill("Returns the greeting.");

  // --- pre-request script rewrites the body; post-request script rewrites the response ---
  await page.getByRole("tab", { name: "Body" }).click();
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.locator('textarea[aria-label="Request body"]').fill('{"uid":"u1","params":{"a":"b"}}');
  await page.getByRole("tab", { name: "Pre-request" }).click();
  await page.locator('textarea[aria-label="Pre-request script"]').fill(
    `const b = JSON.parse(pm.request.body.raw);
const sum = CryptoJS.SHA1(JSON.stringify(b.params) + "KEY");
postman.setGlobalVariable("checksum", sum);
pm.request.body.raw = { checksum: "{{checksum}}", params: b.params, uid: b.uid };`,
  );
  await page.getByRole("tab", { name: "Post-request" }).click();
  await page.locator('textarea[aria-label="Post-request script"]').fill(
    `const d = pm.response.json();
pm.response.setBody({ sent: JSON.parse(d.echo), via: "post-script" });
pm.test("hello is world", () => pm.expect(d.hello).to.equal("world"));`,
  );
  await page.keyboard.press("Control+Enter");
  await page.locator(".pill", { hasText: "200 OK" }).waitFor();
  await page.locator(".jt", { hasText: "post-script" }).waitFor();
  await page.locator(".badge-mod").waitFor();
  assert.match(await page.locator(".log").innerText(), /Request modified by pre-request script/);
  assert.match(await page.locator(".log").innerText(), /Response modified by post-request script/);
  await page.getByRole("tab", { name: /^Request/ }).click();
  const sent = JSON.parse(await page.locator(".raw").innerText());
  assert.match(sent.checksum, /^[0-9a-f]{40}$/, "pre-request script put a SHA1 checksum into the body that was sent");
  await page.getByRole("tab", { name: /^Tests/ }).click();
  await page.locator(".tests", { hasText: "PASS" }).waitFor();
  await page.getByRole("tab", { name: "Raw" }).click();
  await page.locator(".raw", { hasText: '"via"' }).waitFor();
  await page.keyboard.press("Control+s");
  await page.getByText("Saved").first().waitFor();

  // --- members: pick several people from the full list ---
  await page.getByLabel("More").click();
  await page.getByRole("menuitem", { name: "Members" }).click();
  await page.locator(".modal").waitFor();
  assert.equal(await page.locator(".optlist").count(), 0, "autofocus must not pop the people list open");
  assert.equal(await page.getByRole("combobox", { name: "People to add" }).evaluate((el) => document.activeElement === el), true, "but the field is focused");
  await page.getByLabel("People to add").click();
  await page.locator(".opt").first().waitFor();
  assert.deepEqual(
    (await page.locator(".opt .opt-label").allInnerTexts()).sort(),
    ["Ali Reza", "Mona K", "Sara Lee"],
    "picker lists every user that is not a member yet",
  );
  await page.getByRole("option", { name: /Sara Lee/ }).click();
  await page.getByRole("combobox", { name: "People to add" }).fill("ali");
  await page.getByRole("option", { name: /Ali Reza/ }).click();
  await page.getByRole("button", { name: /^Add 2/ }).click();
  await page.getByText("2 members added").waitFor();
  const row = page.locator(".member", { hasText: "Sara Lee" });
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: "editor" }).click();
  await page.getByText("Role updated").waitFor();
  const members = await page.evaluate(() => fetch("/api/workspaces").then((r) => r.json()).then((w) => fetch(`/api/workspaces/${w[0].id}/members`).then((r) => r.json())));
  assert.equal(members.find((m) => m.username === "sara").role, "editor");
  assert.equal(members.find((m) => m.username === "ali").role, "viewer");
  assert.deepEqual(errors, [], "no uncaught page errors");

  // --- a new member signs in with username/password ---
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(base);
  await p2.fill("input[name=username]", "Sara");
  await p2.fill("input[name=password]", "password123");
  await p2.getByRole("button", { name: "Sign in" }).last().click();
  await p2.locator(".node", { hasText: "Users API" }).waitFor();
});
