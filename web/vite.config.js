import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "../package.json"), "utf8"));
export default defineConfig({
  root: here,
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: path.resolve(here, "../dist"), emptyOutDir: true, sourcemap: false },
  // `npm run dev` (API on :3000) + `npm run dev:web` (UI on :5173 with hot reload)
  server: { port: 5173, proxy: { "/api": "http://localhost:3000", "/healthz": "http://localhost:3000" } },
});
