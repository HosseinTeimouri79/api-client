// E2E: the whole UI in every language — detected from the browser, flag + label picker, translated text actually shown,
// no missing keys, and the page direction (RTL for Arabic and Persian) including component layout.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LOCALES } from "../web/src/i18n/locales.js";
const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, base, admin;
const dict = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l.id, (await import(`../web/src/i18n/locales/${l.id}.js`)).default])));
const RAW_KEY = /\b(?:common|auth|top|welcome|ws|members|role|settings|admin|viewer|snippet|app|sidebar|tabs|req|kv|body|script|help|snip|code|resp|col|dlg|env|interop|vars|ui|err)\.[a-zA-Z][\w.]*/;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  admin = await j("POST", "/auth/register", { username: "root", password: "password123" }); // the first account is the admin
});
after(async () => { await browser?.close(); server?.close(); });

const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
async function seed(username) {
  const u = await j("POST", "/auth/register", { username, password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, u.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "API", description: "docs" }, u.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "List users", method: "GET", url: "http://127.0.0.1:1/users", params: [], headers: [], body: { mode: "none" } }, u.token);
  await j("POST", `/workspaces/${ws}/environments`, { name: "Dev", variables: [{ key: "k", value: "v" }] }, u.token);
  return u;
}
const noRawKeys = async (page, where) => assert.doesNotMatch(await page.evaluate(() => document.body.innerText), RAW_KEY, `a translation key is showing on screen (${where})`);

for (const l of LOCALES)
  test(`E2E ${l.id}: ${l.label} — detected from the browser, translated, ${l.dir.toUpperCase()}`, { skip, timeout: 90000 }, async () => {
    const d = dict[l.id];
    const user = await seed(`u_${l.id.toLowerCase().replace("-", "_")}`);
    const ctx = await browser.newContext({ locale: l.id, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator("button[type=submit]").waitFor();

    // language and direction come from the browser's language
    assert.equal(await page.evaluate(() => document.documentElement.lang), l.id);
    assert.equal(await page.evaluate(() => document.documentElement.dir), l.dir);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).direction), l.dir);
    // the picker shows flag + native name
    const picker = page.locator(".auth-lang .select");
    assert.equal(await picker.locator("svg.flag").count(), 1);
    assert.match(await picker.textContent(), new RegExp(l.label.replace(/[()]/g, "\\$&")));
    // and the form is in that language
    assert.equal((await page.locator(".auth-card .field-l").first().textContent()).trim(), d["auth.username"]);
    assert.equal((await page.locator("button[type=submit]").textContent()).trim(), d["auth.signIn"]);
    await noRawKeys(page, "sign-in");

    await page.fill("input[name=username]", `u_${l.id.toLowerCase().replace("-", "_")}`);
    await page.fill("input[name=password]", "password123");
    await page.locator("button[type=submit]").click();
    await page.locator(".side").waitFor();
    assert.equal(await page.locator(".side .tabstrip-i").first().textContent().then((s) => s.trim()), d["sidebar.collections"]);
    await noRawKeys(page, "main screen");

    // layout follows the direction: the sidebar sits at the start edge, the request area after it
    const [side, main] = await Promise.all([page.locator(".side").boundingBox(), page.locator(".main").boundingBox()]);
    assert.equal(side.x < main.x, l.dir === "ltr", `sidebar position in ${l.dir}`);
    assert.ok(Math.abs((l.dir === "ltr" ? side.x : 1280 - side.x - side.width)) < 2, `the sidebar touches the start edge of the window: ${JSON.stringify(side)} main ${JSON.stringify(main)}`);

    // open a request: code, URLs and JSON stay left-to-right in every language
    await page.locator(".node", { hasText: "API" }).first().click();
    await page.locator(".node", { hasText: "List users" }).first().click();
    await page.locator(".url-input").waitFor();
    assert.equal(await page.locator(".url-input input").first().evaluate((el) => getComputedStyle(el).direction), "ltr");
    assert.equal(await page.locator(".req-head input").evaluate((el) => getComputedStyle(el).direction), l.dir, "text inputs follow the language");
    assert.equal(await page.locator(".editor .tabstrip-i").first().textContent().then((s) => s.trim()), d["req.params"]);
    await noRawKeys(page, "request editor");

    // dialogs: members, environments, import/export, code snippet, account menu
    await page.locator(".top button:has(i.fa-ellipsis)").click();
    await page.locator("[role=menuitem]").nth(0).click(); // Members
    await page.locator(".modal").waitFor();
    assert.equal((await page.locator(".modal-h h2").textContent()).trim(), d["members.title"]);
    await noRawKeys(page, "members"); await page.keyboard.press("Escape");
    await page.locator(".top button:has(i.fa-ellipsis)").click();
    await page.locator("[role=menuitem]").nth(2).click(); // Workspace (global) variables
    await page.locator(".modal").waitFor();
    assert.equal((await page.locator(".modal-h h2").textContent()).trim(), d["env.globals"]);
    await noRawKeys(page, "environments"); await page.keyboard.press("Escape");
    await page.locator(".top button:has(i.fa-ellipsis)").click();
    await page.locator("[role=menuitem]").nth(1).click(); // Import / Export
    await page.locator(".modal").waitFor();
    assert.equal((await page.locator(".modal-h h2").textContent()).trim(), d["top.importExport"]);
    await noRawKeys(page, "import / export"); await page.keyboard.press("Escape");
    await page.locator(".req-head button:has(i.fa-code)").click();
    await page.locator("pre.snippet").waitFor();
    assert.equal((await page.locator(".modal-h h2").textContent()).trim(), d["snippet.title"]);
    assert.match(await page.locator("pre.snippet").textContent(), /^curl --location/, "code stays left-to-right and untranslated");
    assert.equal(await page.locator("pre.snippet").evaluate((el) => getComputedStyle(el).direction), "ltr");
    await noRawKeys(page, "code snippet"); await page.keyboard.press("Escape");
    // account menu → settings (every tab)
    await page.locator(".user-btn").click();
    await page.locator("[role=menuitem]").nth(1).click();
    await page.locator(".settings-subtabs").waitFor();
    for (const key of ["settings.tab.general", "settings.tab.profile"]) {
      await page.locator(".admin-in > .tabstrip .tabstrip-i", { hasText: d[key] }).first().click();
      for (const sub of await page.locator(".settings-subtabs [role=tab]").all()) { await sub.click(); await noRawKeys(page, `settings ${key}`); }
    }
    assert.deepEqual(errors, []);
    await ctx.close();
    void user;
  });

test("E2E: the language picker lists all 15 languages with a flag and the native name; the choice mirrors the page and sticks to the account", { skip, timeout: 90000 }, async () => {
  await seed("picker");
  const page = await (await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(base);
  await page.fill("input[name=username]", "picker");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".side").waitFor();
  const select = page.getByRole("combobox", { name: "Language" });
  await select.click();
  const options = page.getByRole("option");
  assert.equal(await options.count(), 15);
  assert.deepEqual(await options.locator(".lang-name").allTextContents(), LOCALES.map((l) => l.label));
  assert.equal(await options.locator("svg.flag").count(), 15, "a flag next to every name");
  // typing narrows the list (by native name or code)
  await page.locator(".select-search").fill("deu");
  assert.deepEqual(await options.locator(".lang-name").allTextContents(), ["Deutsch"]);
  await page.keyboard.press("Escape");
  await select.click();
  await page.getByRole("option", { name: /العربية/ }).click();
  await page.locator("html[dir=rtl]").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ar-SA");
  // mirrored layout: the sidebar is on the right now; dragging its splitter towards the left makes it wider
  const side = await page.locator(".side").boundingBox();
  assert.ok(side.x > 640, "the sidebar moved to the right edge");
  const before = side.width, sp = await page.locator(".side-split").boundingBox();
  await page.mouse.move(sp.x + 2, sp.y + 100); await page.mouse.down(); await page.mouse.move(sp.x - 60, sp.y + 100, { steps: 4 }); await page.mouse.up();
  assert.ok((await page.locator(".side").boundingBox()).width > before + 40, "RTL drag direction is mirrored");
  // popup menus open under their button, not off-screen
  await page.locator(".user-btn").click();
  const menu = await page.locator(".popover .menu-in").boundingBox();
  assert.ok(menu.x >= 0 && menu.x + menu.width <= 1280);
  await page.keyboard.press("Escape");
  // stored on the account: a new browser signs in directly in Arabic
  await page.waitForTimeout(800);
  const fresh = await (await browser.newContext({ locale: "en-US" })).newPage();
  await fresh.goto(base);
  await fresh.fill("input[name=username]", "picker");
  await fresh.fill("input[name=password]", "password123");
  await fresh.locator("button[type=submit]").click();
  await fresh.locator("html[lang=ar-SA]").waitFor();
  assert.equal(await fresh.evaluate(() => document.documentElement.dir), "rtl");
  // and back
  await fresh.locator(".lang-select").click();
  await fresh.getByRole("option", { name: /English/ }).click();
  await fresh.locator("html[dir=ltr]").waitFor();
});
