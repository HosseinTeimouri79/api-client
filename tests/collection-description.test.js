// Collections and folders carry a description (like requests): API, duplicate, and Postman/Hoppscotch import-export.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { parseImport, toPostmanCollection, toHoppCollection } from "../src/services/interop.js";

let server, base, tok, ws;
before(async () => {
  server = createApp(openDb(":memory:")).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  tok = (await (await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "docs", password: "password123" }) })).json()).token;
  ws = (await call("POST", "/workspaces", { name: "W" })).body.id;
});
after(() => server.close());
const call = async (m, p, b) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("api: create, edit, read and duplicate a collection description", async () => {
  const W = `/workspaces/${ws}`;
  const made = await call("POST", `${W}/collections`, { name: "Billing", description: "Invoices & payments" });
  assert.equal(made.status, 201);
  const id = made.body.id;
  assert.equal((await call("GET", `${W}/collections/${id}`)).body.description, "Invoices & payments");
  assert.equal((await call("POST", `${W}/collections`, { name: "Plain" })).status, 201); // optional
  assert.equal((await call("PATCH", `${W}/collections/${id}`, { description: "Billing v2\n\nsecond paragraph" })).status, 200);
  const got = (await call("GET", `${W}/collections/${id}`)).body;
  assert.equal(got.description, "Billing v2\n\nsecond paragraph");
  // other fields don't wipe it, and it has a size limit
  await call("PATCH", `${W}/collections/${id}`, { name: "Billing 2" });
  assert.equal((await call("GET", `${W}/collections/${id}`)).body.description, "Billing v2\n\nsecond paragraph");
  assert.equal((await call("PATCH", `${W}/collections/${id}`, { description: "x".repeat(10001) })).status, 400);
  // duplicate keeps it
  const dup = await call("POST", `${W}/collections/${id}/duplicate`, {});
  assert.equal((await call("GET", `${W}/collections/${dup.body.id}`)).body.description, "Billing v2\n\nsecond paragraph");
});

test("postman: description on the collection and on folders, string or { content }", () => {
  const data = {
    info: { name: "Shop", description: { content: "Root **docs**", type: "text/markdown" }, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: [
      { name: "Users", description: "Folder docs", item: [{ name: "List", request: { method: "GET", url: "https://x.io/u", description: "Request docs" } }] },
      { name: "NoDocs", item: [] },
    ],
  };
  const c = parseImport(data).collections[0];
  assert.equal(c.description, "Root **docs**");
  assert.equal(c.folders[0].description, "Folder docs");
  assert.equal(c.folders[0].requests[0].description, "Request docs");
  assert.equal(c.folders[1].description, "");
  const out = toPostmanCollection(c, "id");
  assert.equal(out.info.description, "Root **docs**");
  assert.equal(out.item[0].description, "Folder docs");
  assert.equal(out.item[0].item[0].request.description, "Request docs");
  assert.ok(!("description" in out.item[1]), "empty descriptions are not written");
  const again = parseImport(out).collections[0];
  assert.deepEqual([again.description, again.folders[0].description, again.folders[0].requests[0].description], ["Root **docs**", "Folder docs", "Request docs"]);
});

test("hoppscotch: no description support, so export says so", () => {
  const n = { name: "C", description: "docs", variables: [], auth: null, pre_script: "", post_script: "", folders: [], requests: [] };
  const warnings = [];
  toHoppCollection(n, null, (m) => warnings.push(m));
  assert.ok(warnings.some((w) => /descriptions have no Hoppscotch equivalent/.test(w)));
  const quiet = [];
  toHoppCollection({ ...n, description: "" }, null, (m) => quiet.push(m));
  assert.deepEqual(quiet, []);
});

test("api: import then export keeps collection descriptions end to end", async () => {
  const W = `/workspaces/${ws}`;
  const data = {
    info: { name: "Imported", description: "Imported root docs", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: [{ name: "Folder", description: "Imported folder docs", item: [{ name: "R", request: { method: "GET", url: "https://x.io/r", description: "R docs" } }] }],
  };
  const imp = await call("POST", `${W}/import`, { data });
  assert.equal(imp.status, 201);
  const tree = (await call("GET", `${W}/tree`)).body;
  const root = tree.collections.find((c) => c.name === "Imported");
  const folder = tree.collections.find((c) => c.parent_id === root.id);
  assert.equal((await call("GET", `${W}/collections/${root.id}`)).body.description, "Imported root docs");
  assert.equal((await call("GET", `${W}/collections/${folder.id}`)).body.description, "Imported folder docs");
  const exp = await call("GET", `${W}/export?format=postman&collection=${root.id}`);
  assert.equal(exp.status, 200);
  assert.equal(exp.body.data.info.description, "Imported root docs");
  assert.equal(exp.body.data.item[0].description, "Imported folder docs");
  assert.equal(exp.body.data.item[0].item[0].request.description, "R docs");
  const hopp = await call("GET", `${W}/export?format=hoppscotch&collection=${root.id}`);
  assert.ok(hopp.body.warnings.some((w) => /descriptions/.test(w)));
});
