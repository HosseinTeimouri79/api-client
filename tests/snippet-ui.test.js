// E2E: the Code snippet dialog — defaults to cURL, switches language through the autocomplete, follows the editor.
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

test("E2E: code snippet — cURL by default, switch language with the autocomplete, variables and unsaved edits", { skip, timeout: 60000 }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.goto(base);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.fill("input[name=username]", "dev");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.locator(".modal input").fill("W");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: "New collection" }).first().click();
  await page.locator(".modal input").fill("C");
  await page.getByRole("button", { name: "Create" }).click();
  // collection auth that the request inherits
  const wsId = (await (await page.request.get(base + "/api/workspaces")).json())[0].id;
  const cols = await (await page.request.get(`${base}/api/workspaces/${wsId}/tree`)).json();
  await page.request.patch(`${base}/api/workspaces/${wsId}/collections/${cols.collections[0].id}`, { data: { auth: { type: "bearer", token: "inherited-token" } }, headers: { "x-requested-with": "api-client" } });
  await page.locator(".node", { hasText: "C" }).first().hover();
  await page.locator(".node", { hasText: "C" }).first().getByLabel("New request").click();
  await page.locator(".modal input").fill("Get users");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByLabel("URL", { exact: true }).fill("https://api.example.com/users");
  await page.keyboard.press("Tab");

  // default: cURL
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const code = page.locator("pre.snippet");
  await code.waitFor();
  assert.equal(await page.locator(".optlist").count(), 0, "the language list starts closed");
  await page.waitForFunction(() => document.querySelector("pre.snippet")?.textContent.includes("inherited-token"));
  assert.match(await code.textContent(), /^curl --location 'https:\/\/api\.example\.com\/users' \\\n  --header 'Authorization: Bearer inherited-token'/);
  assert.equal(await page.locator(".modal").getByRole("combobox", { name: "Language" }).inputValue(), "");
  assert.ok(await page.locator(".ac-single").textContent() === "cURL");

  // switch through the autocomplete: type, arrow, enter
  const combo = page.locator(".modal").getByRole("combobox", { name: "Language" });
  await combo.click();
  assert.ok((await page.locator(".opt-group").allTextContents()).includes("Node.js"), "variants are grouped by language");
  await combo.fill("py req");
  await page.getByRole("option", { name: "Requests" }).click();
  // picking closes the list and drops focus, so clicking the field again opens it again
  assert.equal(await page.locator(".optlist").count(), 0);
  assert.equal(await combo.evaluate((el) => document.activeElement === el), false);
  await combo.click();
  await page.locator(".optlist").waitFor();
  await page.keyboard.press("Escape"); // Escape closes it and also drops focus
  assert.equal(await page.locator(".optlist").count(), 0);
  assert.equal(await combo.evaluate((el) => document.activeElement === el), false);
  await combo.click();
  await page.locator(".optlist").waitFor();
  assert.match(await code.textContent(), /import requests[\s\S]*requests\.request\("GET", url/);
  await combo.fill("axios");
  await page.keyboard.press("Enter");
  assert.match(await code.textContent(), /require\("axios"\)/);
  assert.equal(await page.locator(".ac-single").textContent(), "Node.js – Axios");
  await combo.fill("zzzz");
  await page.getByText("No matching language").waitFor();
  await page.keyboard.press("Escape");

  // copy
  await page.getByRole("button", { name: "Copy" }).click();
  await page.locator(".toast", { hasText: "Copied" }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /require\("axios"\)/);
  await page.keyboard.press("Escape");

  // the choice is remembered; the dialog reflects unsaved edits to the request
  await page.getByRole("tab", { name: "Body" }).click();
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.locator('textarea[aria-label="Request body"]').fill('{"a":1}');
  await page.getByLabel("Method").click();
  await page.getByRole("option", { name: "POST" }).click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.locator("pre.snippet").waitFor();
  assert.equal(await page.locator(".ac-single").textContent(), "Node.js – Axios");
  assert.match(await page.locator("pre.snippet").textContent(), /method: "post"[\s\S]*let data = "\{\\"a\\":1\}"|let data = "\{\\"a\\":1\}"[\s\S]*method: "post"/);
  assert.deepEqual(errors, []);
});
