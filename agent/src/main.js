#!/usr/bin/env node
// API Client Local Agent: sends the web app's requests from this computer, so they can reach localhost and the local
// network. One program for Linux, macOS and Windows; see `help` below and README.md → "Local Agent".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { spawn, execFileSync } from "node:child_process";
import { isSea } from "node:sea";
import { agentPaths } from "./paths.js";
import { Store, normalizeOrigin, DEFAULT_CONFIG } from "./store.js";
import { createLogger } from "./log.js";
import { createService, readPid, writePid, clearPid, RESTART_EXIT_CODE } from "./service.js";
import { applyUpdate, checkForUpdate } from "./update.js";
import { applyIntegration, removeIntegration } from "./integration.js";

/* global __AGENT_VERSION__, __AGENT_BUNDLED__ */
const BUNDLED = typeof __AGENT_BUNDLED__ !== "undefined" && __AGENT_BUNDLED__;
const VERSION = typeof __AGENT_VERSION__ !== "undefined"
  ? __AGENT_VERSION__
  : JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
const MIN_NODE = "22.13.0";
// Two forms of the same program: the script (agent.mjs, run with Node.js) and the standalone executable that the
// installers ship (Node.js built in, agent/packaging/build.mjs). A standalone copy under /usr or /opt was installed by a
// system package (.deb), which owns the file: setup then only adds the per-user background service.
const STANDALONE = (() => { try { return isSea(); } catch { return false; } })();
const EXE = process.platform === "win32" ? "api-client-agent.exe" : "api-client-agent";
const self = STANDALONE ? process.execPath : fileURLToPath(import.meta.url);
const PACKAGED = STANDALONE && /^\/(usr|opt)\//.test(self);
let pauseAtExit = false; // started by double-clicking: keep the window open so the messages can be read

const HELP = `API Client Local Agent ${VERSION}

Usage: api-client-agent <command> [options]     (or: node agent.mjs <command>)

  setup [--server URL]                guided install (what opening the installer does): installs, starts and opens the
                                      agent's page in your browser (without a desktop: asks here, prints a pairing code)
  ui [--print]                        open the agent's page: status, sites, pairing, network access, activity, settings
                                      (--print: only print the one-time address)
  install [--server URL] [--port N] [--no-service]
                                      copy the agent to its folder, run it in the background at logon, allow the
                                      web app at URL and print a pairing code (--no-service: portable, start it with run)
  uninstall [--purge]                 stop it and remove the background service (--purge: also settings and tokens)
  start | stop | restart | status     control the background agent
  run [--port N]                      run in the foreground (what the background service runs)
  pair [--origin URL]                 print a one-time code to type into the web app (default: the install server)
  origins [add URL | remove URL]      list or change the sites allowed to use the agent
  tokens [revoke ID]                  list or revoke paired sites
  config [get KEY | set KEY VALUE]    show or change settings, e.g. "config set targets.linkLocal true",
                                      "config set targets.allow *.corp.local,10.0.0.0/8", "config set port 47900"
  update [--check] [--force] [--sha256 HASH] [--server URL]
                                      install the agent version the server offers (checked against its SHA-256)
  version | help

Files: settings in ${agentPaths().config}, program in ${agentPaths().install}, logs in ${agentPaths().logs}.
`;

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  // opened without arguments in a window (double-click): the standalone program sets itself up, or opens its page when
  // it is the installed copy (main() decides). Without a terminal (scripts, pipes) or as the script, it only shows the
  // help: installing needs someone who asked for it.
  return { cmd: pos[0] ?? (STANDALONE && process.stdin.isTTY && process.stdout.isTTY ? "default" : "help"), args: pos.slice(1), flags };
}
/** Waits for Enter when there is someone to press it. */
function pause(msg = "Press Enter to close this window.") {
  if (!process.stdin.isTTY) return;
  process.stdout.write(`\n${msg}`);
  try { fs.readSync(0, Buffer.alloc(16)); } catch { /* not readable: just exit */ }
}
/** Windows keeps a program locked for a moment after it exits (an older agent that was just stopped). */
function copyWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return fs.copyFileSync(from, to); } catch (e) {
      if (i >= 20 || !["EBUSY", "EPERM", "EACCES"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}
const die = (msg, code = 1) => { console.error(`error: ${msg}`); if (pauseAtExit) pause(); process.exit(code); };
const nodeTooOld = () => {
  const [a, b] = process.versions.node.split(".").map(Number), [x, y] = MIN_NODE.split(".").map(Number);
  return a < x || (a === x && b < y);
};

/** Is there a desktop to open a browser on (not over SSH / in a container)? */
const hasDesktop = () => process.platform !== "linux" || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
/** Opens `url` in the default browser; false when that did not work. API_CLIENT_AGENT_NO_BROWSER=1 never opens one. */
function openBrowser(url) {
  if (process.env.API_CLIENT_AGENT_NO_BROWSER === "1" || !hasDesktop()) return Promise.resolve(false);
  const [cmd, args] = process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }); } catch { return resolve(false); }
    // most openers return at once; one that keeps running has started the browser
    const t = setTimeout(() => { child.unref(); resolve(true); }, 5000);
    child.once("error", () => { clearTimeout(t); resolve(false); });
    child.once("exit", (code) => { clearTimeout(t); resolve(code === 0 || process.platform === "win32"); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A one-time address that opens the agent's page (swapped for a session cookie, see ui.js). */
const uiLink = (store, port) => `http://127.0.0.1:${port}/ui/open?key=${store.startUiLaunch()}`;

async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function waitHealthy(port, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 300))) if (await health(port)) return true;
  return false;
}
const printPairing = (p) => {
  console.log(`\nPairing code for ${p.origin}:\n\n    ${p.code}\n`);
  console.log(`Open the web app → Settings → Local Agent (or the Server/Local switch in the header), choose Local and type the code.`);
  console.log(`The code works once and expires at ${new Date(p.expiresAt).toLocaleTimeString()}.`);
};
// "true" / "false" / numbers / comma lists, for `config set`
const coerce = (key, v, current) => {
  if (Array.isArray(current)) return key === "udpListenPorts" ? v.split(",").filter(Boolean).map((r) => r.split("-").map(Number)).map(([a, b = a]) => [a, b]) : v.split(",").map((x) => x.trim()).filter(Boolean);
  if (typeof current === "boolean") { if (!["true", "false"].includes(v)) throw new Error(`${key} is true or false`); return v === "true"; }
  if (typeof current === "number") { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${key} is a number`); return n; }
  return v;
};

async function main() {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2));
  if (!STANDALONE && nodeTooOld()) die(`Node.js ${MIN_NODE} or newer is required (this is ${process.versions.node})`);
  const paths = agentPaths();
  const store = new Store(paths.config);
  // the installed program and the command that starts it
  const program = PACKAGED ? self : path.join(paths.install, STANDALONE ? EXE : "agent.mjs");
  const command = STANDALONE ? [program] : [process.execPath, program];
  // API_CLIENT_AGENT_SERVICE: the service runs the agent and starts it again when it exits to restart (see run)
  const service = () => createService({ command, paths, packaged: PACKAGED, env: { API_CLIENT_AGENT_SERVICE: "1", ...(process.env.API_CLIENT_AGENT_HOME && { API_CLIENT_AGENT_HOME: process.env.API_CLIENT_AGENT_HOME }) } });
  const cliName = PACKAGED || STANDALONE ? "api-client-agent" : `node "${program}"`;

  /** Copies the program into place, starts it at logon and allows `server`; prints a pairing code for it (`pairing`). */
  async function install({ server, port, noService = false, pairing = true }) {
    if (!BUNDLED) die("install from the built agent: npm run build, then node dist/agent/agent.mjs install");
    if (!PACKAGED) {
      fs.mkdirSync(paths.install, { recursive: true });
      if (path.resolve(self) !== path.resolve(program)) {
        if (STANDALONE && fs.existsSync(program)) service().stop(); // an older copy may be running from there
        copyWithRetry(self, program);
      }
      if (STANDALONE) fs.chmodSync(program, 0o755);
      // macOS: the user already chose to open the download; the installed copy should not ask again at every login
      if (process.platform === "darwin" && STANDALONE) try { execFileSync("xattr", ["-d", "com.apple.quarantine", program], { stdio: "ignore" }); } catch { /* not quarantined */ }
    }
    if (port) store.updateConfig({ port: Number(port) });
    let origin = null;
    if (server) {
      origin = normalizeOrigin(/^[a-z][a-z0-9+.-]*:\/\//i.test(server) ? server : `https://${server}`);
      if (!origin) die(`not a web address: ${server}`);
      store.allowOrigin(origin);
      store.updateConfig({ server: origin });
    }
    if (noService) {
      // portable: nothing is registered with the system; the user starts it when needed
      console.log(`Installed ${program}\nNo background service (--no-service): start it with ${[...command, "run"].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ")}`);
    } else {
      const s = service();
      s.install();
      console.log(`Installed ${program}\nBackground service: ${s.kind} (${s.files.map((f) => f.path).join(", ") || "installed by the package"})`);
      if (!PACKAGED) {
        const { uiAssets } = await import("./ui-assets.js");
        console.log(applyIntegration({ command, dir: paths.install, version: VERSION, icon: uiAssets()?.get("logo.png")?.body ?? null }));
      }
    }
    const p = store.config().port;
    if (!noService) console.log((await waitHealthy(p)) ? `The agent is running on http://127.0.0.1:${p}` : `The agent did not answer on port ${p} yet; check "${cliName} status" and ${paths.logs}`);
    if (!PACKAGED) store.write("installed.json", { version: VERSION });
    if (!pairing) return;
    if (origin) printPairing(store.startPairing(origin));
    else console.log(`Allow your API Client site with: ${cliName} pair --origin https://your-api-client`);
  }
  /** Opens the agent's page, starting the background agent first when it is installed but not running. */
  async function openUi({ print = false } = {}) {
    const rt = store.read("runtime.json", {});
    let port = readPid(paths) && rt.pid === readPid(paths) ? rt.port : store.config().port;
    if (!(await health(port)) && service().status() !== "not installed") { service().start(); port = store.config().port; await waitHealthy(port); }
    if (!(await health(port))) die(`the agent is not running; start it with "${cliName} start" (or "${cliName} run")`);
    const url = uiLink(store, port);
    if (!print && (await openBrowser(url))) return true;
    console.log(`Open this address in your browser (it works once, for 2 minutes):\n\n    ${url}\n`);
    return false;
  }

  switch (cmd) {
    case "run": {
      const log = createLogger(paths.logs);
      const { startAgent } = await import("./server.js");
      const running = readPid(paths);
      if (running && running !== process.pid) die(`the agent is already running (pid ${running}); use "restart"`);
      const port = flags.port !== undefined ? Number(flags.port) : undefined;
      // what the agent's page may ask the running program to do (agent/src/ui.js)
      const control = {
        managed: process.env.API_CLIENT_AGENT_SERVICE === "1", // the service starts it again after restart()
        packaged: PACKAGED, paths,
        checkUpdate: async () => {
          const s = store.config().server;
          if (!s) throw new Error("No API Client site to update from: add one first");
          const r = await checkForUpdate({ server: s, current: VERSION });
          return { available: r.available, current: r.current, latest: r.latest };
        },
        update: BUNDLED && !PACKAGED ? () => applyUpdate({ server: store.config().server, target: self, current: VERSION, standalone: STANDALONE }) : null,
      };
      let server;
      try {
        server = await startAgent({ store, version: VERSION, log, port, control });
      } catch (e) {
        die(e.code === "EADDRINUSE" ? `port ${port ?? store.config().port} is in use (change it: config set port N)` : e.message);
      }
      writePid(paths);
      store.write("runtime.json", { pid: process.pid, port: server.address().port }); // for `ui` when it runs on another port
      if (process.platform === "win32") fs.rmSync(`${self}.old`, { force: true }); // left by an update
      if (store.read("installed.json", {}).version !== VERSION && BUNDLED && !PACKAGED && path.resolve(self) === path.resolve(program)) {
        // the first start after an update: service files and shortcuts as this version makes them
        try {
          service().refresh();
          const { uiAssets } = await import("./ui-assets.js");
          applyIntegration({ command, dir: paths.install, version: VERSION, icon: uiAssets()?.get("logo.png")?.body ?? null });
          store.write("installed.json", { version: VERSION });
        } catch (e) { log.warn("could not refresh the install after an update", { message: e.message }); }
      }
      const addr = server.address();
      log.info(`API Client Local Agent ${VERSION} listening on http://127.0.0.1:${addr.port}`, { origins: store.config().origins });
      const stop = (code = 0) => { clearPid(paths); server.close(); server.closeAllConnections?.(); setTimeout(() => process.exit(code), 200).unref(); };
      control.restart = () => { log.info("restarting (from the agent's page)"); stop(RESTART_EXIT_CODE); };
      control.stop = () => { log.info("stopping (from the agent's page)"); stop(0); };
      process.on("SIGTERM", () => stop(0));
      process.on("SIGINT", () => stop(0));
      process.on("unhandledRejection", (e) => log.error("unhandledRejection", { message: e?.message }));
      // optional: install updates by itself once a day (config set autoUpdate true)
      const cfg = store.config();
      if (cfg.autoUpdate && cfg.server && BUNDLED && !PACKAGED) {
        const tick = async () => {
          try {
            const r = await applyUpdate({ server: cfg.server, target: self, current: VERSION, standalone: STANDALONE });
            if (r.updated) { log.info(`updated to ${r.version}; restarting`); stop(RESTART_EXIT_CODE); }
          } catch (e) { log.warn("update check failed", { message: e.message }); }
        };
        setTimeout(tick, 60_000).unref();
        setInterval(tick, 24 * 3600_000).unref();
      }
      return;
    }

    case "setup": {
      pauseAtExit = true;
      console.log(`API Client Local Agent ${VERSION} — setup\n\nThe agent sends API Client's requests from this computer, so they can reach localhost and your\nlocal network. It is installed for your user only and starts when you log in.\n`);
      let server = flags.server ?? store.config().server;
      const noService = !!flags["no-service"];
      // with a desktop, the rest happens on the agent's page (address, pairing code); otherwise here
      const browse = !noService && hasDesktop() && !flags["no-browser"];
      const ask = async () => {
        if (server || !process.stdin.isTTY) return;
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        server = (await rl.question("Address of your API Client (e.g. https://api.example.com): ")).trim() || null;
        rl.close();
      };
      if (!browse) await ask();
      await install({ server, port: flags.port, noService, pairing: !browse });
      if (browse) {
        const port = store.config().port;
        if ((await health(port)) && (await openBrowser(uiLink(store, port)))) {
          console.log(`\nThe agent's page is open in your browser: ${server ? "pair your API Client there" : "type your API Client's address there"}.\nOpen it again later from the "API Client Agent" shortcut or with: ${cliName} ui`);
          await sleep(4000); // time to read it; the window closes by itself
          return;
        }
        // no browser after all: as without a desktop
        await ask();
        if (server) {
          const origin = store.allowOrigin(normalizeOrigin(/^[a-z][a-z0-9+.-]*:\/\//i.test(server) ? server : `https://${server}`) ?? die(`not a web address: ${server}`));
          if (!store.config().server) store.updateConfig({ server: origin });
          printPairing(store.startPairing(origin));
        }
      }
      console.log(`\nManage it later with: ${cliName} ui | status | pair | update | uninstall`);
      pause();
      return;
    }

    case "default": {
      // double-clicked: the installed copy (Start menu, a terminal) opens its page; a downloaded one installs itself
      const installedCopy = PACKAGED || path.resolve(self) === path.resolve(program);
      if (installedCopy && service().status() !== "not installed") {
        pauseAtExit = true;
        if (!(await openUi())) pause();
        return;
      }
      process.argv.splice(2, 0, "setup");
      return main();
    }

    case "ui": case "open": await openUi({ print: !!flags.print }); return;

    case "install": await install({ server: flags.server, port: flags.port, noService: !!flags["no-service"] }); return;

    case "uninstall": {
      pauseAtExit = !!flags.pause; // from Settings → Apps → Uninstall on Windows
      service().uninstall();
      fs.rmSync(path.join(paths.install, "run-hidden.ps1"), { force: true });
      if (PACKAGED) console.log("The background service was removed. Remove the program with your package manager (sudo apt remove api-client-agent).");
      else {
        removeIntegration({ command, dir: paths.install, version: VERSION });
        if (process.platform === "win32" && STANDALONE && path.resolve(self) === path.resolve(program)) {
          // a running .exe cannot delete itself: a hidden helper removes it once this process has ended
          spawn("cmd.exe", ["/d", "/c", `ping -n 3 127.0.0.1 >nul & del /f /q "${program}" "${program}.old" & rmdir "${paths.install}"`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        } else fs.rmSync(program, { force: true }); // Node does not keep a script open, so this works while it runs
      }
      if (flags.purge) {
        for (const d of new Set([paths.config, paths.logs, ...(PACKAGED ? [] : [paths.install])])) fs.rmSync(d, { recursive: true, force: true, maxRetries: 2 });
        console.log("The agent, its settings, tokens and logs were removed.");
      } else console.log(`The agent was removed. Settings and paired sites are kept in ${paths.config} (remove them with "uninstall --purge").`);
      if (pauseAtExit) pause();
      return;
    }

    case "start": service().start(); console.log((await waitHealthy(store.config().port)) ? "Started." : "Started, but it does not answer yet; see status."); return;
    case "stop": service().stop(); console.log("Stopped."); return;
    case "restart": service().restart(); console.log((await waitHealthy(store.config().port)) ? "Restarted." : "Restarted, but it does not answer yet; see status."); return;

    case "status": {
      const c = store.config();
      const h = await health(c.port);
      console.log(`Agent ${VERSION}\nService:   ${service().status()}\nListening: ${h ? `yes, http://127.0.0.1:${c.port} (version ${h.version})` : "no"}`);
      console.log(`Sites:     ${c.origins.join(", ") || "(none; run pair --origin URL)"}\nPaired:    ${store.tokens().length} token(s)\nTargets:   ${Object.entries(c.targets).filter(([, v]) => typeof v === "boolean").map(([k, v]) => `${k}=${v}`).join(" ")}${c.targets.allow.length ? ` allow=${c.targets.allow.join(",")}` : ""}${c.targets.deny.length ? ` deny=${c.targets.deny.join(",")}` : ""}`);
      console.log(`Settings:  ${paths.config}\nLogs:      ${paths.logs}`);
      return;
    }

    case "pair": {
      const origin = flags.origin ?? store.config().server;
      if (!origin) die("which site? pair --origin https://your-api-client");
      try { printPairing(store.startPairing(origin)); } catch (e) { die(e.message); }
      return;
    }

    case "origins": {
      if (args[0] === "add") { try { console.log(`Allowed ${store.allowOrigin(args[1])}`); } catch (e) { die(e.message); } return; }
      if (args[0] === "remove") { store.removeOrigin(args[1]); console.log(`Removed ${args[1]} and its tokens`); return; }
      console.log(store.config().origins.join("\n") || "(no sites allowed)");
      return;
    }

    case "tokens": {
      if (args[0] === "revoke") { const n = store.revokeToken(args[1] ?? ""); console.log(n ? `Revoked ${n} token(s)` : "No such token"); return; }
      const list = store.tokens();
      if (!list.length) return console.log("(no paired sites)");
      for (const t of list) console.log(`${t.id.slice(0, 8)}  ${t.origin}  paired ${t.createdAt}  last used ${t.lastUsedAt ?? "never"}  ${t.label}`);
      return;
    }

    case "config": {
      const c = store.config();
      if (args[0] === "get") return console.log(JSON.stringify(args[1].split(".").reduce((o, k) => o?.[k], c), null, 2));
      if (args[0] === "set") {
        const [key, value] = [args[1], args[2]];
        const [top, sub] = String(key).split(".");
        const known = sub ? DEFAULT_CONFIG[top]?.[sub] : DEFAULT_CONFIG[top];
        if (known === undefined || ["origins", "server"].includes(top)) die(`unknown or read-only setting: ${key}`);
        try {
          const v = coerce(key, String(value ?? ""), known);
          store.updateConfig(sub ? { [top]: { ...store.read("config.json", {})[top], [sub]: v } } : { [top]: v });
        } catch (e) { die(e.message); }
        console.log(`${key} = ${JSON.stringify(args[1].split(".").reduce((o, k) => o?.[k], store.config()))}  (restart the agent to apply: restart)`);
        return;
      }
      console.log(JSON.stringify(c, null, 2));
      return;
    }

    case "update": {
      const server = flags.server ?? store.config().server;
      if (!server) die("no server to update from: update --server https://your-api-client");
      if (flags.check) {
        const r = await checkForUpdate({ server, current: VERSION });
        console.log(r.available ? `Version ${r.latest} is available (installed: ${r.current}). Run "update".` : `Up to date (${r.current}).`);
        return;
      }
      if (PACKAGED) die("this agent was installed by a system package: install the server's new .deb instead (Settings → Local Agent)");
      const target = fs.existsSync(program) ? program : self;
      const r = await applyUpdate({ server, target, current: VERSION, expectSha256: flags.sha256, force: !!flags.force, standalone: STANDALONE });
      if (!r.updated) return console.log(`Up to date (${VERSION}).`);
      console.log(`Updated ${r.previous} → ${r.version}.`);
      if (readPid(paths) || service().status() === "running") { service().restart(); console.log("The background agent was restarted."); }
      return;
    }

    case "version": case "--version": case "-v": console.log(VERSION); return;
    case "help": case "--help": case "-h": console.log(HELP); return;
    default: die(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

process.stdout.on("error", (e) => { if (e.code !== "EPIPE") throw e; }); // output piped into `head` and closed early
main().catch((e) => die(e.message));
