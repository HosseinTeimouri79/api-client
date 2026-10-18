// E2E: Server and Local mode in the browser: the server cannot reach a local API, the Local Agent can; pairing from the
// header, switching while the app runs, the agent going away and coming back, and the Local Agent settings page.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { agentHome, pairingCode, startAgent } from "./fixtures/agent.js";

const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const dist = new URL("../dist/index.html", import.meta.url);
const skip = (!CHROME && "no Chromium found (set CHROME_PATH)") || (!fs.existsSync(dist) && "UI not built (npm run build)");
let browser, server, base, target, targetUrl, agent, home;

before(async () => {
  if (skip) return;
  const { chromium } = await import("playwright-core");
  const { openDb } = await import("../src/db/index.js");
  const { createApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  config.allowPrivateTargets = false; // like a shared server: it must not reach the user's machine
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  target = http.createServer((req, res) => (req.url.startsWith("/fail") ? res.writeHead(503).end("down") : res.writeHead(200, { "content-type": "application/json" }).end('{"from":"local api"}'))).listen(0, "127.0.0.1");
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

test("E2E: Server and Local mode: pair, switch while running, agent stops and comes back, errors are explained", { skip, timeout: 120000 }, async () => {
  const j = (method, path, body, token) => fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const me = await j("POST", "/auth/register", { username: "localmode", password: "password123" });
  const ws = (await j("POST", "/workspaces", { name: "Team" }, me.token)).id;
  const col = (await j("POST", `/workspaces/${ws}/collections`, { name: "Local APIs" }, me.token)).id;
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Health", method: "GET", url: `${targetUrl}/health` }, me.token);
  await j("POST", `/workspaces/${ws}/collections/${col}/requests`, { name: "Broken", method: "GET", url: `${targetUrl}/fail` }, me.token);

  const ctx = await browser.newContext();
  await ctx.addInitScript((url) => localStorage.setItem("agent.url", url), agent.url);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.fill("input[name=username]", "localmode");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.locator(".node", { hasText: "Local APIs" }).first().click();
  await page.locator(".node", { hasText: "Health" }).first().click();
  const mode = page.getByRole("button", { name: "Run requests from" });
  const send = () => page.locator("#sendBtn").click();

  // Server mode (the default): the server refuses a local target
  assert.equal((await mode.textContent()).trim(), "Server");
  await send();
  await page.locator(".errbox", { hasText: "SSRF protection" }).waitFor();

  // switch to Local: the agent does not know this site yet, so to the browser it is not reachable; the panel says how
  // to allow the site, and the code that command prints pairs it
  await mode.click();
  await page.getByRole("radio", { name: /Local/ }).click();
  await page.locator(".mode-pop").getByText("Not reachable").waitFor();
  await page.locator(".mode-pop").getByText(`api-client-agent pair --origin ${base}`).waitFor();
  const code = pairingCode(home, base);
  await page.locator(".mode-pop").getByRole("textbox", { name: "Pairing code" }).fill("WRON-GCOD");
  await page.locator(".mode-pop").getByRole("button", { name: "Pair" }).click();
  await page.locator(".mode-pop").getByText("Wrong pairing code").waitFor();
  await page.locator(".mode-pop").getByRole("textbox", { name: "Pairing code" }).fill(code);
  await page.locator(".mode-pop").getByRole("button", { name: "Pair" }).click();
  await page.locator(".mode-pop").getByText("Connected").waitFor();
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 300);

  // the same request now goes out from this computer, scripts and history as usual
  await send();
  await page.locator(".resp-meta .via-badge", { hasText: "Local Agent" }).waitFor();
  assert.equal((await page.locator(".resp-meta .pill").textContent()).trim(), "200 OK");
  await page.getByText('"local api"').first().waitFor();

  // an error status from the API is a normal response
  await page.locator(".node", { hasText: "Broken" }).first().click();
  await send();
  await page.locator(".resp-meta .pill", { hasText: "503" }).waitFor();

  // the agent stops: the run fails with an explanation, the header turns red
  await agent.stop();
  await page.locator(".node", { hasText: "Health" }).first().click();
  await send();
  await page.locator(".errbox", { hasText: "Local Agent is not reachable" }).waitFor();
  await page.getByText("Sent in Local mode: check the Local Agent").waitFor();
  await page.locator(".mode-btn .agent-dot.err").waitFor();

  // it comes back on the same port: the header notices and requests work again
  agent = await startAgent(home, { port: agent.port });
  await page.locator(".mode-btn .agent-dot.ok").waitFor({ timeout: 15000 });
  await send();
  await page.locator(".resp-meta .pill", { hasText: "200" }).waitFor();

  // back to Server mode while the app runs
  await mode.click();
  await page.getByRole("radio", { name: /Server/ }).click();
  await page.mouse.click(5, 300);
  assert.equal((await mode.textContent()).trim(), "Server");
  await send();
  await page.locator(".errbox", { hasText: "SSRF protection" }).waitFor();

  // the settings page: mode, status, installers / install commands, management commands
  await mode.click();
  await page.getByRole("button", { name: "Local Agent settings…" }).click();
  await page.getByRole("tab", { name: "Local Agent", selected: true }).waitFor();
  await page.getByText("api-client-agent uninstall").waitFor();
  await page.getByText("Or install with a command").waitFor();
  const built = (() => { try { return JSON.parse(fs.readFileSync(new URL("../build/installers/index.json", import.meta.url), "utf8")).files; } catch { return []; } })();
  if (built.some((f) => f.kind === "exe")) {
    const win = page.locator("a.agent-dl", { hasText: "Windows installer (.exe)" });
    assert.match(await win.getAttribute("href"), /^\/agent\/download\/api-client-agent-setup-.*-windows-x64\.exe$/);
    assert.equal((await page.locator("a.agent-dl.btn-primary").first().textContent()).includes("This computer"), true, "this computer's installer comes first");
  }
  assert.deepEqual(errors, []);
});
