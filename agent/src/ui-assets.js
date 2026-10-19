import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* global __AGENT_UI__ */
// The agent's page (web/agent-ui, built into dist/agent-ui/). The bundled agent carries the files inside itself
// (agent/vite.config.js puts them in __AGENT_UI__), so the standalone program needs nothing next to it; run from the
// source, it reads dist/agent-ui/.
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };
export const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Reads a built page folder into { "<path>": base64 } (for agent/vite.config.js). */
export function packUi(dir) {
  if (!fs.existsSync(path.join(dir, "index.html"))) return null;
  const out = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String)) {
    const full = path.join(dir, rel);
    if (fs.statSync(full).isFile()) out[rel.split(path.sep).join("/")] = fs.readFileSync(full).toString("base64");
  }
  return out;
}

let cache;
/** Map "<path>" -> { type, body }, or null when the page was not built (npm run build). */
export function uiAssets() {
  if (cache !== undefined) return cache;
  const packed = typeof __AGENT_UI__ !== "undefined" ? __AGENT_UI__ : packUi(fileURLToPath(new URL("../../dist/agent-ui/", import.meta.url)));
  cache = packed ? new Map(Object.entries(packed).map(([p, b64]) => [p, { type: typeOf(p), body: Buffer.from(b64, "base64") }])) : null;
  return cache;
}
