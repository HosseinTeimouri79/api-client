import { defineConfig } from "vite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Bundles the Local Agent and everything it uses (the shared engine in core/, express, ws, gRPC, MQTT, AMQP ...) into one
// file, dist/agent/agent.mjs, that runs with a plain Node.js on Linux, macOS and Windows. `npm run build` runs it.
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "../package.json"), "utf8"));
// AGENT_FORMAT=cjs: the CommonJS copy that the installers build into standalone executables (agent/packaging/build.mjs)
const cjs = process.env.AGENT_FORMAT === "cjs";
export default defineConfig({
  root: here,
  logLevel: "warn",
  define: { __AGENT_VERSION__: JSON.stringify(pkg.version), __AGENT_BUNDLED__: "true" },
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: path.resolve(here, "src/main.js"),
    outDir: path.resolve(here, "../dist/agent"),
    emptyOutDir: !cjs,
    target: "node22",
    minify: false,
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: cjs ? "agent.cjs" : "agent.mjs", format: cjs ? "cjs" : "es", codeSplitting: false } },
  },
});
