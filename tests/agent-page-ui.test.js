// E2E: the Local Agent's own page (http://127.0.0.1:<port>/ui/) next to the web app: opened with its one-time link,
// the first site added there and paired by typing the page's code into the web app, the request showing up in the
// page's activity, a network rule changed there taking effect at once, unpairing from the page, locking it.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { agentHome, cli, startAgent } from "./fixtures/agent.js";

const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const built = fs.existsSync(new URL("../dist/index.html", import.meta.url)) && fs.existsSync(new URL("../dist/agent-ui/index.html", import.meta.url));
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!built && "UI not built (npm run build)");
let browser, server, base, target, targetUrl, agent, home;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../server/db/index.js");
  const { createApp } = await import("../server/app.js");
  const { config } = await import("../server/config.js");
  Object.assign(config, { allowPrivateTargets: false, agentReleases: "off" });
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  target = http.createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end('{"from":"local api"}')).listen(0, "127.0.0.1");
  await new Promise((r) => target.once("listening", r));
  targetUrl = `http://127.0.0.1:${target.address().port}`;
  home = agentHome();
  agent = await startAgent(home);
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  await agent?.stop();
  server?.close();
  target?.close();
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("E2E: the agent's page: welcome, pairing the web app with its code, activity, network rules, unpair, lock", { skip, timeout: 120000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "agentpage", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Local APIs" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Health", method: "GET", url: `${targetUrl}/health` }, me.token);

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));

  // without its link the page is locked
  const stranger = await ctx.newPage();
  watch(stranger);
  await stranger.goto(`${agent.url}/ui/`);
  await stranger.getByText("This page is locked").waitFor();
  await stranger.getByText("api-client-agent ui").waitFor();
  await stranger.close();

  // opened with the link (what the shortcut and setup do): a fresh agent welcomes with the address field
  const ap = await ctx.newPage();
  watch(ap);
  await ap.goto(cli(home, "ui", "--print").match(/http:\/\/\S+/)[0]);
  await ap.getByText("Connect your API Client").waitFor();
  await ap.getByText("Running", { exact: true }).first().waitFor();
  await ap.getByRole("textbox", { name: "Address of your API Client" }).fill("not an address ::");
  await ap.getByRole("button", { name: "Add" }).click();
  await ap.getByText("That is not a web address").waitFor();
  await ap.getByRole("textbox", { name: "Address of your API Client" }).fill(base);
  await ap.getByRole("button", { name: "Add" }).click();
  const code = (await ap.locator(".au-pair-code").textContent()).trim();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await ap.getByText("Waiting for the site to use the code").waitFor();

  // the web app: Local mode, the page's code
  const web = await ctx.newPage();
  watch(web);
  await web.addInitScript((url) => localStorage.setItem("agent.url", url), agent.url);
  await web.goto(base);
  await web.fill("input[name=username]", "agentpage");
  await web.fill("input[name=password]", "password123");
  await web.getByRole("button", { name: "Sign in" }).last().click();
  await web.locator(".node", { hasText: "Local APIs" }).first().click();
  await web.locator(".node", { hasText: "Health" }).first().click();
  const mode = web.getByRole("button", { name: "Run requests from" });
  await mode.click();
  await web.getByRole("radio", { name: /Local/ }).click();
  await web.locator(".mode-pop").getByRole("textbox", { name: "Pairing code" }).fill(code);
  await web.locator(".mode-pop").getByRole("button", { name: "Pair" }).click();
  await web.locator(".mode-pop").getByText("Connected").waitFor();
  await web.keyboard.press("Escape");
  await web.mouse.click(5, 300);

  // the agent's page sees the pairing by itself
  await ap.getByText(`${base} is paired`).waitFor({ timeout: 10000 });
  await ap.getByRole("tab", { name: "Sites" }).click();
  const card = ap.locator(".au-site", { hasText: base });
  await card.getByText(/^Chrome \d+$/).waitFor();
  await card.getByText("Updates from here").waitFor();

  // a request from the web app shows up in Activity
  await web.locator("#sendBtn").click();
  await web.locator(".resp-meta .via-badge", { hasText: "Local Agent" }).waitFor();
  await ap.getByRole("tab", { name: "Activity" }).click();
  const row = ap.locator("table.au-act tbody tr", { hasText: targetUrl }).first();
  await row.waitFor({ timeout: 10000 });
  assert.match(await row.textContent(), /GET/);
  assert.match(await row.locator("td").last().textContent(), /^200/);
  assert.ok(!(await ap.locator("table.au-act").textContent()).includes("/health"), "addresses only, no paths");

  // network rules from the page apply to the next request
  await ap.getByRole("tab", { name: "Network access" }).click();
  await ap.getByRole("checkbox", { name: "This computer" }).uncheck();
  await ap.getByRole("button", { name: "Save" }).click();
  await ap.getByText("Network access saved").waitFor();
  await web.locator("#sendBtn").click();
  await web.locator(".errbox", { hasText: "targets.loopback" }).waitFor();
  await ap.getByRole("checkbox", { name: "This computer" }).check();
  await ap.getByRole("button", { name: "Save" }).click();
  await ap.getByText("Network access saved").last().waitFor();
  await web.locator("#sendBtn").click();
  await web.locator(".resp-meta .pill", { hasText: "200" }).waitFor();

  // unpairing from the page: the web app is no longer let in
  await ap.getByRole("tab", { name: "Sites" }).click();
  await card.getByRole("button", { name: "Unpair" }).click();
  await ap.locator(".modal").getByRole("button", { name: "Unpair" }).click();
  await card.getByText("Not paired yet").waitFor();
  await web.locator(".mode-btn .agent-dot.ok").waitFor({ state: "detached", timeout: 15000 });

  // the page in Persian, right to left
  await ap.getByRole("combobox", { name: "Language" }).click();
  await ap.getByRole("option", { name: /فارسی/ }).click();
  await ap.getByRole("tab", { name: "سایت‌ها" }).waitFor();
  assert.equal(await ap.evaluate(() => document.documentElement.dir), "rtl");

  // locking it: the cookie is no longer valid
  await ap.locator(".au-top").getByRole("button").last().click();
  await ap.getByText("این صفحه قفل است").waitFor();
  await ap.reload();
  await ap.getByText("این صفحه قفل است").waitFor();
  assert.deepEqual(errors, []);
});
