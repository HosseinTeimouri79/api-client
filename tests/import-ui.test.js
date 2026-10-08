// E2E: Import / Export dialog: after a successful import the chosen file is cleared and Import is disabled again.
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

test("E2E: a successful import empties the file choice; a failed file stays", { skip, timeout: 60000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "importer", password: "password123" });
  await j("POST", "/workspaces", { name: "Team" }, me.token);
  const page = await (await browser.newContext()).newPage();
  await page.goto(base);
  await page.fill("input[name=username]", "importer");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Import / Export" }).click();

  const importBtn = page.locator(".modal").getByRole("button", { name: "Import", exact: true });
  const drop = page.locator(".dropzone");
  const choose = "Click to choose Postman or Hoppscotch .json files";
  assert.equal(await importBtn.isDisabled(), true, "nothing chosen yet");
  const collection = { info: { name: "Imported API", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [{ name: "ping", request: { method: "GET", url: "https://x.io/ping" } }] };
  const file = (name, body) => ({ name, mimeType: "application/json", buffer: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)) });

  await page.locator(".dropzone input").setInputFiles(file("api.postman_collection.json", collection));
  assert.match(await drop.textContent(), /api\.postman_collection\.json/);
  assert.equal(await importBtn.isDisabled(), false);
  await importBtn.click();
  await page.locator(".interop-result.ok").waitFor();
  assert.match(await drop.textContent(), new RegExp(choose), "the chosen file is cleared");
  assert.equal(await importBtn.isDisabled(), true, "Import is inactive again");
  assert.equal(await page.locator(".interop-result.ok").count(), 1, "the result stays visible");
  // the result is three lines: type, count, file
  const rows = () => page.locator(".interop-result.ok").last().locator(".interop-rows > div").evaluateAll((l) => l.map((d) => [...d.children].map((c) => c.textContent)));
  assert.deepEqual(await rows(), [["Type", "Collection (Postman)"], ["Count", "1 collection(s), 1 request(s)"], ["File", "api.postman_collection.json"]]);

  // an environment file: type Environments, the count of environments
  const env = { id: "e1", name: "Staging", values: [{ key: "host", value: "x", enabled: true }, { key: "k", value: "v", enabled: true }], _postman_variable_scope: "environment" };
  await page.locator(".dropzone input").setInputFiles(file("staging.postman_environment.json", env));
  await importBtn.click();
  await page.locator(".interop-result.ok").nth(0).waitFor();
  assert.deepEqual(await rows(), [["Type", "Environments (Postman)"], ["Count", "1 environment(s)"], ["File", "staging.postman_environment.json"]]);

  // the same file can be chosen again
  await page.locator(".dropzone input").setInputFiles(file("api.postman_collection.json", collection));
  assert.equal(await importBtn.isDisabled(), false);

  // one good and one broken file: the good one is cleared, the broken one stays selected
  await page.locator(".dropzone input").setInputFiles([file("good.json", collection), file("broken.json", "{nope")]);
  await importBtn.click();
  await page.locator(".interop-result.err").waitFor();
  assert.equal(await page.locator(".interop-result").count(), 2);
  const left = await drop.textContent();
  assert.ok(left.includes("broken.json") && !left.includes("good.json"), left);
  assert.equal(await importBtn.isDisabled(), false, "the failed file can be retried or replaced");
});
