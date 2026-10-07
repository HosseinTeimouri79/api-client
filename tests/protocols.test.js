// The browser's protocol list and the server's must agree on which protocols work.
import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOLS as SERVER, IMPLEMENTED } from "../src/protocols/index.js";
import { PROTOCOLS as CLIENT } from "../web/src/lib/protocols.js";

test("same protocols in the same order, and the same ones are implemented", () => {
  assert.deepEqual(CLIENT.map((p) => p.id), SERVER);
  assert.deepEqual(CLIENT.filter((p) => p.implemented).map((p) => p.id), IMPLEMENTED);
});
