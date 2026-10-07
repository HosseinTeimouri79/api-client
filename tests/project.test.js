// Project metadata: one version everywhere, and the licence files that carry the attribution requirement.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { version } from "../src/config.js";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

test("the version comes from package.json and is reported by /healthz", async () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(version, pkg.version);
  const server = createApp(openDb(":memory:")).listen(0);
  try {
    const r = await (await fetch(`http://127.0.0.1:${server.address().port}/healthz`)).json();
    assert.deepEqual(r, { ok: true, version: pkg.version });
  } finally { server.close(); }
});

test("the changelog documents the current version", () => {
  assert.match(read("CHANGELOG.md"), new RegExp(`^## \\[${pkg.version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}`, "m"));
});

test("Apache-2.0 licence, with a NOTICE that names the author and the source", () => {
  assert.equal(pkg.license, "Apache-2.0");
  assert.match(read("LICENSE"), /Apache License\s+Version 2\.0, January 2004/);
  const notice = read("NOTICE");
  assert.match(notice, /Copyright \d{4} Hossein Teimouri/);
  assert.ok(notice.includes(pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")), "NOTICE links to the source repository");
  assert.match(read("README.md"), /## License and attribution/);
  assert.ok(!fs.existsSync(new URL("../docs", import.meta.url)), "documentation lives in the README");
});
