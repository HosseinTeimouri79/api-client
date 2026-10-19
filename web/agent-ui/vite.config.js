import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The Local Agent's own page (served by the agent at http://127.0.0.1:47823/ui/). Built into dist/agent-ui/ and from
// there into the agent itself (agent/vite.config.js), after the web app (`npm run build`). It shares the web app's
// components, styles and translations (web/src).
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "../../package.json"), "utf8"));
export default defineConfig({
  root: here,
  base: "/ui/",
  plugins: [react()],
  publicDir: path.resolve(here, "../public"),
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "warn",
  build: { outDir: path.resolve(here, "../../dist/agent-ui"), emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  // `npm run dev:agent-ui`: this page with hot reload, talking to an agent on the default port
  server: { port: 5174, proxy: { "/ui/api": "http://127.0.0.1:47823", "/ui/open": "http://127.0.0.1:47823" } },
});
