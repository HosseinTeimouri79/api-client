// E2E: environments live in the header selector: "New environment…", edit and delete icons on each environment, and the
// workspace (global) variables in the More menu. Import / export of environments is in the Import / Export dialog.
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

test("E2E: environment selector actions", { skip, timeout: 60000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "envuser", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/environments`, { name: "Staging", variables: [{ key: "host", value: "staging.example.com", enabled: true }] }, me.token);
  const viewer = await j("POST", "/auth/register", { username: "lookeronly", password: "password123" });
  await j("POST", `/workspaces/${ws}/members`, { user_ids: [viewer.user.id], role: "viewer" }, me.token);
  const envs = async () => j("GET", `/workspaces/${ws}/environments`, undefined, me.token);

  const login = async (user) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(base);
    await page.fill("input[name=username]", user);
    await page.fill("input[name=password]", "password123");
    await page.getByRole("button", { name: "Sign in" }).last().click();
    await page.locator(".env-select").waitFor();
    return page;
  };
  const page = await login("envuser");
  assert.equal(await page.getByRole("button", { name: "Environments", exact: true }).count(), 0, "no Environments button");
  await page.getByRole("button", { name: "More" }).click();
  assert.deepEqual((await page.getByRole("menuitem").allInnerTexts()).map((x) => x.trim()), ["Members", "Import / Export", "Workspace (global) variables"]);
  await page.keyboard.press("Escape");

  // the selector: none, the environments (with edit and delete icons), then "New environment…"
  await page.locator(".env-select").click();
  assert.deepEqual((await page.locator(".opt").allInnerTexts()).map((x) => x.trim()), ["No environment", "Staging", "New environment…"]);
  await page.locator(".opt", { hasText: "New environment…" }).click();
  await page.locator(".modal").getByRole("button", { name: "Create" }).isDisabled().then((d) => assert.equal(d, true, "a name is required"));
  await page.locator(".modal input").first().fill("Production");
  await page.locator('.modal .kv input[aria-label="Key"]').first().fill("baseUrl");
  await page.locator('.modal .kv input[aria-label="Value"]').first().fill("https://prod.example.com");
  await page.locator(".modal").getByRole("button", { name: "Create" }).click();
  await page.locator(".env-select", { hasText: "Production" }).waitFor();
  const prod = (await envs()).find((e) => e.name === "Production");
  assert.deepEqual(prod.variables.map((v) => [v.key, v.value]), [["baseUrl", "https://prod.example.com"]]);

  // edit: the pen icon opens the dialog with the name and variables filled in; it closes the list
  await page.locator(".env-select").click();
  await page.locator(".opt", { hasText: "Staging" }).hover();
  await page.locator(".opt", { hasText: "Staging" }).getByRole("button", { name: "Edit environment" }).click();
  assert.equal(await page.locator(".opt").count(), 0, "the list closes");
  assert.equal(await page.locator(".modal input").first().inputValue(), "Staging");
  assert.equal(await page.locator('.modal .kv input[aria-label="Value"]').first().inputValue(), "staging.example.com");
  await page.locator(".modal input").first().fill("Staging EU");
  await page.locator('.modal .kv input[aria-label="Value"]').first().fill("eu.example.com");
  await page.locator(".modal").getByRole("button", { name: "Save" }).click();
  await page.locator(".modal").waitFor({ state: "detached" });
  const staging = (await envs()).find((e) => e.name === "Staging EU");
  assert.equal(staging.variables[0].value, "eu.example.com");

  // delete: asks first
  await page.locator(".env-select").click();
  await page.locator(".opt", { hasText: "Staging EU" }).hover();
  await page.locator(".opt", { hasText: "Staging EU" }).getByRole("button", { name: "Delete environment" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  assert.equal((await envs()).length, 2, "cancel keeps it");
  await page.locator(".env-select").click();
  await page.locator(".opt", { hasText: "Staging EU" }).hover();
  await page.locator(".opt", { hasText: "Staging EU" }).getByRole("button", { name: "Delete environment" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll(".env-select")].some((e) => e.textContent.includes("Staging")));
  assert.deepEqual((await envs()).map((e) => e.name), ["Production"]);

  // global variables from the More menu
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Workspace (global) variables" }).click();
  await page.locator('.modal .kv input[aria-label="Key"]').first().fill("region");
  await page.locator('.modal .kv input[aria-label="Value"]').first().fill("eu-west");
  await page.locator(".modal").getByRole("button", { name: "Save" }).click();
  await page.locator(".modal").waitFor({ state: "detached" });
  assert.deepEqual((await j("GET", `/workspaces/${ws}`, undefined, me.token)).variables.map((v) => [v.key, v.value]), [["region", "eu-west"]]);

  // import / export of environments is in the Import / Export dialog
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("tab", { name: "Export" }).click();
  await page.locator(".modal .select").last().click();
  assert.ok((await page.locator(".opt-group").allInnerTexts()).some((g) => /environments/i.test(g)));
  await page.keyboard.press("Escape");

  // a viewer sees the environments but no edit / delete icons and no "New environment…"
  const v = await login("lookeronly");
  await v.locator(".env-select").click();
  assert.deepEqual((await v.locator(".opt").allInnerTexts()).map((x) => x.trim()), ["No environment", "Production"]);
  assert.equal(await v.locator(".opt-acts").count(), 0);
});
