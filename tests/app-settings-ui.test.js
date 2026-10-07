// E2E: Settings → General (request limits, interface, editor, application, about) and what they change.
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

const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());

async function signedIn(username = "dev") {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(base);
  await page.fill("input[name=username]", username);
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  return page;
}
const openGeneral = async (page) => {
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "General" }).click();
};
const back = (page) => page.getByRole("button", { name: "Back to app" }).click();
const cssVar = (page, name) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);

test("E2E: general settings apply, sync to the account and survive a reload", { skip, timeout: 120000 }, async () => {
  const u = await j("POST", "/auth/register", { username: "dev", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "W" }, u.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "C" }, u.token)).id;
  const rid = (await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "R", method: "POST", url: "http://127.0.0.1:1/x", params: [], headers: [], body: { mode: "json", content: "" } }, u.token)).id;
  const stored = () => j("GET", `/workspaces/${ws}/requests/${rid}`, undefined, u.token);

  const page = await signedIn();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".node", { hasText: "C" }).first().click();
  await openGeneral(page);

  // Profile has two tabs, each showing only its own form
  assert.equal(await page.getByRole("tab", { name: "Security" }).count(), 0);
  await page.getByRole("tab", { name: "Profile", exact: true }).click();
  await page.getByRole("tab", { name: "Profile details" }).waitFor();
  await page.getByLabel("Display name").waitFor();
  assert.equal(await page.getByLabel("Current password").count(), 0, "password form is not on the details tab");
  await page.getByRole("tab", { name: "Change password" }).click();
  await page.getByLabel("Current password").waitFor();
  assert.equal(await page.getByLabel("Display name").count(), 0, "details are not on the password tab");

  // General has one tab per group; switching shows only that group
  await page.getByRole("tab", { name: "General" }).click();
  assert.deepEqual(await page.locator(".settings-subtabs [role=tab]").allTextContents(), ["Application", "User interface", "Request", "Editor", "About"], "tab order");
  assert.equal(await page.locator(".settings-subtabs [aria-selected=true]").textContent(), "Application", "opens on Application");
  const groups = { Request: "Request timeout (ms)", "User interface": "Layout type", Editor: "Font size (px)", Application: "Autosave", About: "free and open-source software" };
  for (const [tab, marker] of Object.entries(groups)) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.getByText(marker).first().waitFor();
    for (const [other, m] of Object.entries(groups)) if (other !== tab) assert.equal(await page.getByText(m).count(), 0, `${m} must not show on the ${tab} tab`);
  }
  assert.match(await page.locator(".about").first().textContent(), /API Client\s*v\d+\.\d+\.\d+/);

  // --- Application: theme, app font, autosave
  await page.getByRole("tab", { name: "Application", exact: true }).click();
  await page.getByRole("tab", { name: "Light", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.getByRole("combobox", { name: "App font" }).click();
  await page.getByRole("option", { name: "Georgia" }).click();
  assert.match(await cssVar(page, "--app-font"), /Georgia/);
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Georgia/);
  await page.getByRole("combobox", { name: "App font" }).click();
  await page.getByRole("option", { name: "Custom…" }).click();
  await page.getByLabel("App font (Custom…)").fill("Tahoma; } body { display:none");
  assert.doesNotMatch(await cssVar(page, "--app-font"), /display/, "characters that could break out of the declaration are refused");
  await page.getByLabel("App font (Custom…)").fill("Tahoma, sans-serif");
  assert.equal(await cssVar(page, "--app-font"), "Tahoma, sans-serif");
  await page.getByLabel("Autosave", { exact: false }).first().check();

  // --- Editor
  await page.getByRole("tab", { name: "Editor", exact: true }).click();
  await page.getByLabel("Font size (px)").fill("18");
  assert.equal(await cssVar(page, "--editor-size"), "18px");
  await page.getByLabel("Font size (px)").fill("99"); // out of range: not applied
  assert.equal(await cssVar(page, "--editor-size"), "18px");
  await page.getByRole("combobox", { name: "Font family" }).click();
  await page.getByRole("option", { name: "Fira Code" }).click();
  assert.match(await cssVar(page, "--editor-font"), /Fira Code/);
  await page.getByLabel("Indentation count").fill("4");
  assert.equal(await cssVar(page, "--indent-size"), "4");
  assert.match(await page.locator(".editor-preview").textContent(), /\n {4}"hello"/);

  // --- Request limits are sent with every run
  await page.getByRole("tab", { name: "Request", exact: true }).click();
  await page.getByLabel("Request timeout (ms)").fill("2500");
  await page.getByLabel("Max response size (MB)").fill("3");

  // --- User interface
  await page.getByRole("tab", { name: "User interface", exact: true }).click();
  await page.getByRole("combobox", { name: "Layout type" }).click();
  await page.getByRole("option", { name: "Response beside the request" }).click();
  await page.getByLabel("Open console on start").check();
  await back(page);

  // open the saved request: editor features follow the settings
  await page.locator(".node", { hasText: "R" }).first().click();
  await page.getByRole("tab", { name: "Body" }).click();
  await page.getByRole("tab", { name: "JSON" }).click();
  await page.locator(".split.cols").waitFor(); // response beside the request
  const body = page.locator('textarea[aria-label="Request body"]');
  await body.click();
  await page.keyboard.type("{");
  assert.equal(await body.inputValue(), "{}", "auto close brackets");
  await page.keyboard.press("Enter");
  assert.equal(await body.inputValue(), "{\n    }", "Enter indents by the configured width");
  await page.keyboard.press("Tab");
  assert.equal(await body.inputValue(), "{\n        }", "Tab inserts four spaces");
  await page.keyboard.type('"k');
  assert.equal(await body.inputValue(), '{\n        "k"}', "quotes close too");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  assert.equal(await body.inputValue(), "{\n        }", "Backspace inside an empty pair removes both halves");

  // autosave: the edit reaches the server on its own
  await page.waitForTimeout(2200);
  assert.equal((await stored()).body.content, "{\n        }", "autosaved");
  assert.equal(await page.locator(".dirty").count(), 0, "tab is clean after autosave");

  // Send carries the user's limits
  const [run] = await Promise.all([page.waitForRequest((r) => r.url().endsWith("/run")), page.getByRole("button", { name: "Send" }).click()]);
  assert.deepEqual(JSON.parse(run.postData()).limits, { timeoutMs: 2500, maxResponseBytes: 3 * 1024 * 1024 });

  // everything reached the account: a fresh browser gets it all (wait out the sync debounce first)
  await page.waitForTimeout(900);
  const me = await j("GET", "/auth/me", undefined, u.token);
  assert.equal(me.user.settings.editor.fontSize, 18);
  assert.equal(me.user.settings.request.timeoutMs, 2500);
  assert.equal(me.user.settings.app.autosave, true);
  const fresh = await signedIn();
  await fresh.locator(".split.cols").count();
  assert.equal(await fresh.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.equal(await cssVar(fresh, "--app-font"), "Tahoma, sans-serif");
  assert.equal(await fresh.locator(".console.closed").count(), 0, "console opens on start");
  assert.deepEqual(errors, []);
});

test("E2E: indent with tabs, auto close can be switched off", { skip, timeout: 60000 }, async () => {
  const u = await j("POST", "/auth/register", { username: "tabber", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "W" }, u.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "C" }, u.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "R", method: "POST", url: "http://x.test/", params: [], headers: [], body: { mode: "json", content: "" } }, u.token);
  await j("PATCH", "/me", { settings: { editor: { indentType: "tab", autoCloseBrackets: false, autoCloseQuotes: false } } }, u.token).catch(() => {});
  const page = await signedIn("tabber");
  await page.locator(".node", { hasText: "C" }).first().click();
  await page.locator(".node", { hasText: "R" }).first().click();
  await page.getByRole("tab", { name: "Body" }).click();
  await page.getByRole("tab", { name: "JSON" }).click();
  const body = page.locator('textarea[aria-label="Request body"]');
  await body.click();
  await page.keyboard.type("{");
  assert.equal(await body.inputValue(), "{", "auto close off");
  await page.keyboard.press("Enter");
  assert.equal(await body.inputValue(), "{\n\t", "Enter indents with a tab");
});
