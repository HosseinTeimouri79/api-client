// The code's layers and who may use whom, so the shared engine stays shared:
//   core/        the request engine (executor, SSRF guard, protocols, live sessions): no Express, database or UI
//   core/shared/ plain JavaScript that also runs in the browser: no Node.js APIs, nothing outside core/shared
//   server/      the API Client server (Express, SQLite, auth, scripts): uses core
//   agent/       the Local Agent: uses core, never the server
//   web/         the UI: the web app (web/src) and the Local Agent's own page (web/agent-ui), which reuses the web app's
//                components, styles and translations; both may use core/shared only
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(m?js|jsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
const imports = (file) => {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  return [...src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map((m) => m[1]);
};
const layer = (spec, from) => (spec.startsWith(".") ? path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, from)), spec)) : spec);
const check = (dir, allowed, why) => {
  const bad = [];
  for (const f of walk(dir)) for (const spec of imports(f)) { const target = layer(spec, f); if (!allowed(target, spec)) bad.push(`${f} imports ${spec}`); }
  assert.deepEqual(bad, [], why);
};
const inside = (target, d) => target === d || target.startsWith(d + path.sep);
const SERVER_ONLY = ["express", "cookie-parser", "helmet", "jsonwebtoken", "bcryptjs", "express-rate-limit", "quickjs-emscripten", "crypto-js", "node:sqlite"];

test("core/ is the shared engine: nothing from the server, the agent or the UI, no web framework or database", () => {
  check("core", (t, spec) => !["server", "agent", "web"].some((d) => inside(t, d)) && !SERVER_ONLY.includes(spec), "core must stay usable by the server and the Local Agent alike");
});
test("core/shared/ runs in the browser too: no Node.js APIs or packages, only other core/shared modules", () => {
  check("core/shared", (t, spec) => spec.startsWith(".") && inside(t, "core/shared"), "the UI imports these files");
});
test("the server and the Local Agent never import each other", () => {
  check("server", (t) => !inside(t, "agent"), "the server talks to the agent only over HTTP (through the browser)");
  check("agent/src", (t) => !inside(t, "server"), "the agent is built without the server");
});
test("the UI uses only core/shared from outside web/", () => {
  check("web/src", (t, spec) => !spec.startsWith(".") || inside(t, "web") || inside(t, "core/shared"), "the browser bundle must not pull in Node.js code");
  check("web/agent-ui", (t, spec) => !spec.startsWith(".") || inside(t, "web") || inside(t, "core/shared"), "the agent's page talks to the agent over HTTP only");
});
test("the agent's page is its own app: it does not pull in the web app's store or server API client", () => {
  check("web/agent-ui", (t) => !["web/src/store.js", "web/src/api.js", "web/src/App.jsx"].includes(t) && !inside(t, "web/src/features"), "only shared components, styles, translations and helpers");
});
