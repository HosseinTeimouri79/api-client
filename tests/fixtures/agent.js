// Runs the real Local Agent (agent/src/main.js) as a child process with its own home folder, like a user's install.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAIN = new URL("../../agent/src/main.js", import.meta.url).pathname;
export const agentHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
const env = (home) => ({ ...process.env, API_CLIENT_AGENT_HOME: home, NODE_ENV: "test" });

/** The agent CLI, e.g. cli(home, "pair", "--origin", url) -> stdout */
export const cli = (home, ...args) => execFileSync(process.execPath, [MAIN, ...args], { env: env(home), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/** A pairing code for `origin`, made the way a user makes one (`pair --origin`). */
export const pairingCode = (home, origin) => cli(home, "pair", "--origin", origin).match(/\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/)[1];

/** Starts `run` and resolves with { port, url, proc, stop() } once it listens. */
export function startAgent(home, { port = 0 } = {}) {
  const proc = spawn(process.execPath, [MAIN, "run", "--port", String(port)], { env: env(home), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`agent did not start: ${out}`)), 15000);
    const onData = (d) => {
      out += d;
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!m) return;
      clearTimeout(t);
      proc.stdout.off("data", onData);
      proc.stdout.resume();
      const p = Number(m[1]);
      resolve({
        port: p, url: `http://127.0.0.1:${p}`, proc,
        stop: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once("exit", r); proc.kill("SIGTERM"); }),
      });
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", (d) => (out += d));
    proc.once("exit", (code) => { clearTimeout(t); reject(new Error(`agent exited (${code}): ${out}`)); });
  });
}
