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
  const { openDb } = await import("../server/db/index.js");
  const { createApp } = await import("../server/app.js");
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

  // limits: the sidebar is at least 310px wide, the editor takes 40%-60% of the split
  const sideW = () => page.evaluate(() => Math.round(document.querySelector(".side").getBoundingClientRect().width));
  const basis = () => page.evaluate(() => document.querySelector(".split > .pane").style.flexGrow);
  await drag(".side-split", -600, 0);
  assert.equal(await sideW(), 310, "sidebar stops at 310px");
  await drag(".split > .splitter.col", 2000, 0);
  assert.equal(await basis(), "0.6", "editor stops at 60%");
  await drag(".split > .splitter.col", -2000, 0);
  assert.equal(await basis(), "0.4", "editor stops at 40%");
  // values saved by an older version (200px, 85%) are brought into range
  await page.evaluate(() => { localStorage.setItem("sidebarW", "200"); localStorage.setItem("editorFrac", "0.85"); });
  await page.reload();
  await page.locator(".side").waitFor();
  assert.equal(await sideW(), 310);

  // a tall console (saved by an older version) never squeezes the panes: both keep their minimum and never overlap,
  // each pane clips its own content, and the editor's tabs wrap instead of running under the response
  const boxes = () => page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height }; };
    const [ed, resp] = document.querySelectorAll(".split > .pane");
    const tabs = [...ed.querySelectorAll(".editor > .tabstrip .tabstrip-i")].map(r);
    return { ed: r(ed), resp: r(resp), console: r(document.querySelector(".console")), tabs, vh: innerHeight, clip: [ed, resp].map((p) => getComputedStyle(p).overflow) };
  });
  const noOverlap = (b, msg) => {
    assert.deepEqual(b.clip, ["hidden", "hidden"], msg);
    assert.ok(b.console.h <= Math.max(96, b.vh - 480) + 1, `${msg}: console ${b.console.h}px leaves room for the panes`);
    for (const t of b.tabs) assert.ok(t.right <= b.ed.right + 1 && t.left >= b.ed.left - 1 && t.bottom <= b.ed.bottom + 1, `${msg}: editor tab inside its pane`);
  };
  await page.evaluate(() => localStorage.setItem("consoleH", "2000"));
  await page.reload();
  if (!(await page.locator(".split").count())) await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.locator(".split.cols").waitFor();
  let b = await boxes();
  noOverlap(b, "side by side");
  assert.ok(b.ed.right <= b.resp.left + 1, "editor and response side by side do not overlap");
  assert.ok(b.ed.w >= 399 && b.resp.w >= 319, `minimum widths (${b.ed.w}, ${b.resp.w})`);
  await page.locator(".pane").nth(1).hover();
  await page.getByLabel("Switch layout").click();
  await page.locator(".split.rows").waitFor();
  b = await boxes();
  noOverlap(b, "stacked");
  assert.ok(b.ed.bottom <= b.resp.top + 1, "editor and response stacked do not overlap");
  assert.ok(b.ed.h >= 229 && b.resp.h >= 139, `minimum heights (${b.ed.h}, ${b.resp.h})`);
  // too narrow for side by side: it stacks instead of overlapping
  await page.locator(".split.rows > .pane").nth(1).hover();
  await page.getByLabel("Switch layout").click();
  await page.locator(".split.cols").waitFor();
  await page.setViewportSize({ width: 960, height: 640 });
  b = await boxes();
  noOverlap(b, "narrow");
  assert.ok(b.ed.bottom <= b.resp.top + 1 && b.ed.w === b.resp.w, "a narrow side-by-side split stacks");
});
