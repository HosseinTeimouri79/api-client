// E2E: dragging a splitter must not change the page layout (the body used to get the flex utility class `row`).
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

test("E2E: resizing panes keeps the page full width (stacked and side-by-side layouts); layout and console defaults", { skip, timeout: 60000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await page.goto(base);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.fill("input[name=username]", "dev");
  await page.fill("input[name=password]", "password123");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.locator(".modal input").fill("W");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: "New request", exact: true }).click();

  const width = () => page.evaluate(() => [document.getElementById("root").getBoundingClientRect().width, document.querySelector(".app").getBoundingClientRect().width]);
  const drag = async (selector, dx, dy) => {
    const box = await page.locator(selector).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    assert.deepEqual(await width(), [1200, 1200], `page shrank while dragging ${selector}`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).display), "block", "body must not become a flex container while dragging");
    await page.mouse.up();
    assert.equal(await page.evaluate(() => document.body.className), "", "drag classes are removed afterwards");
  };

  // defaults: response under the request, console collapsed
  assert.equal(await page.locator(".split.rows").count(), 1, "response is under the request by default");
  assert.equal(await page.locator(".console.closed").count(), 1, "console is closed by default");
  await drag(".split > .splitter.row", 0, 60);
  await page.locator(".console-title").click();
  await drag(".console-split", 0, -40);
  await drag(".side-split", 40, 0);
  await page.locator(".pane").nth(1).hover();
  await page.getByLabel("Switch layout").click(); // response moves next to the request
  await page.locator(".split.cols").waitFor();
  await drag(".split > .splitter.col", 80, 0);
});
