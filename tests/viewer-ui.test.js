// E2E: a view-only member can edit and run a request in their tab, but cannot save.
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
let browser, server, target, base, tbase, seen;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = true;
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  target = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { seen = { m: req.method, u: req.url, h: req.headers, b }; res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  }).listen(0);
  tbase = `http://127.0.0.1:${target.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); target?.close(); });

test("E2E: view-only member edits and runs a request locally; Save is off and nothing is stored", { skip, timeout: 60000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const owner = await j("POST", "/auth/register", { username: "boss", password: "password123" });
  const viewer = await j("POST", "/auth/register", { username: "watcher", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, owner.token)).id;
  await j("POST", `/workspaces/${ws}/members`, { user_ids: [viewer.user.id], role: "viewer" }, owner.token);
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "API" }, owner.token)).id;
  const saved = { name: "List users", method: "GET", url: `${tbase}/users`, params: [], headers: [], body: { mode: "none" } };
  const rid = (await j("POST", `/workspaces/${ws}/collections/${col}/requests`, saved, owner.token)).id;

  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "watcher");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "API" }).first().click();
  await page.locator(".node", { hasText: "List users" }).first().click();

  // everything is editable, saving is not
  await page.getByText("View-only access").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Save" }).isDisabled(), true);
  await page.getByLabel("URL", { exact: true }).fill(`${tbase}/try-out`);
  await page.keyboard.press("Tab");
  await page.getByRole("tab", { name: /^Params/ }).click();
  await page.locator('.kv input[aria-label="Key"]').first().fill("q");
  await page.locator('.kv input[aria-label="Value"]').first().fill("42");
  await page.getByRole("tab", { name: /^Headers/ }).click();
  await page.locator('.kv input[aria-label="Key"]').first().fill("X-Try");
  await page.locator('.kv input[aria-label="Value"]').first().fill("yes");
  await page.getByRole("tab", { name: "Body" }).click();
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.locator('textarea[aria-label="Request body"]').fill('{"hello":"world"}');
  await page.getByLabel("Method").click();
  await page.getByRole("option", { name: "POST" }).click();
  await page.locator(".dirty").first().waitFor(); // the tab shows the local, unsaved changes

  // Ctrl+S explains instead of saving
  await page.keyboard.press("Control+s");
  await page.locator(".toast", { hasText: "changes can't be saved" }).waitFor();

  // Send uses the edited values
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("200").first().waitFor();
  assert.deepEqual([seen.m, seen.u, seen.h["x-try"], seen.b], ["POST", "/try-out?q=42", "yes", '{"hello":"world"}']);

  // nothing reached the server's copy
  const stored = await j("GET", `/workspaces/${ws}/requests/${rid}`, undefined, owner.token);
  assert.deepEqual([stored.method, stored.url, stored.body.mode], ["GET", `${tbase}/users`, "none"]);
  assert.deepEqual(errors, []);
});
