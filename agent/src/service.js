import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";

/**
 * Running the agent in the background, per system, from one code path:
 *  - Linux:   a systemd user service (~/.config/systemd/user/api-client-agent.service); without systemd, an XDG autostart
 *             entry plus a detached process;
 *  - macOS:   a launchd LaunchAgent (~/Library/LaunchAgents/com.apiclient.agent.plist);
 *  - Windows: a Task Scheduler task that starts at logon and runs hidden (no administrator rights needed).
 * Everything runs as the current user, never as root/SYSTEM. The `*Spec` functions are pure (they only build files and
 * commands) so they are tested on every system.
 */
export const SERVICE = { unit: "api-client-agent.service", label: "com.apiclient.agent", task: "API Client Agent" };
export const RESTART_EXIT_CODE = 75; // "updated, start me again"

// ---- file builders ----
const sdQuote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
// `command` starts the agent: [node, agent.mjs] for the script, [api-client-agent] for the standalone executable;
// the service runs `<command> run`.
export function systemdUnit({ command, env = {} }) {
  return [
    "[Unit]",
    "Description=API Client Local Agent",
    "Documentation=https://github.com/HosseinTeimouri79/api-client#local-agent",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${[...command, "run"].map(sdQuote).join(" ")}`,
    ...Object.entries(env).map(([k, v]) => `Environment=${sdQuote(`${k}=${v}`)}`),
    "Restart=on-failure",
    "RestartSec=3",
    "NoNewPrivileges=true",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
export function desktopEntry({ command }) {
  const q = (s) => `"${String(s).replace(/(["`$\\])/g, "\\$1")}"`;
  return ["[Desktop Entry]", "Type=Application", "Name=API Client Agent", `Exec=${[...command, "run"].map(q).join(" ")}`, "X-GNOME-Autostart-enabled=true", "NoDisplay=true", ""].join("\n");
}
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function launchdPlist({ command, logs, env = {} }) {
  const strs = (a) => a.map((x) => `      <string>${xml(x)}</string>`).join("\n");
  const envs = Object.entries(env).map(([k, v]) => `      <key>${xml(k)}</key><string>${xml(v)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${SERVICE.label}</string>
    <key>ProgramArguments</key>
    <array>
${strs([...command, "run"])}
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>5</integer>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>${xml(path.posix.join(logs, "stdout.log"))}</string>
    <key>StandardErrorPath</key><string>${xml(path.posix.join(logs, "stderr.log"))}</string>${envs ? `\n    <key>EnvironmentVariables</key>\n    <dict>\n${envs}\n    </dict>` : ""}
  </dict>
</plist>
`;
}
const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** The hidden launcher the Windows task runs: it restarts the agent after an update or a crash. */
export function windowsLauncher({ command, env = {} }) {
  return [
    "# API Client Local Agent launcher (started hidden by Task Scheduler at logon)",
    ...Object.entries(env).map(([k, v]) => `$env:${k} = ${ps(v)}`),
    "$failures = 0",
    "while ($true) {",
    `  & ${[...command, "run"].map(ps).join(" ")}`,
    "  $code = $LASTEXITCODE",
    "  if ($code -eq 0) { break }",
    `  if ($code -ne ${RESTART_EXIT_CODE}) { $failures++; if ($failures -gt 5) { break }; Start-Sleep -Seconds 3 }`,
    "}",
    "",
  ].join("\r\n");
}
/** PowerShell that registers (or replaces) the logon task for the current user and starts it. */
export function windowsRegisterScript({ launcher }) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${ps(`-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${launcher}"`)}`,
    "$trigger = New-ScheduledTaskTrigger -AtLogOn -User \"$env:USERDOMAIN\\$env:USERNAME\"",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew",
    "$principal = New-ScheduledTaskPrincipal -UserId \"$env:USERDOMAIN\\$env:USERNAME\" -LogonType Interactive -RunLevel Limited",
    `Register-ScheduledTask -TaskName ${ps(SERVICE.task)} -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'API Client Local Agent' -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${ps(SERVICE.task)}`,
  ].join("\n");
}
const encoded = (script) => Buffer.from(script, "utf16le").toString("base64");

/** Where the service files go and which commands manage them. Pure: nothing is written or run. */
// `packaged`: a system package (.deb) already ships the unit in /usr/lib/systemd/user, so none is written to the home folder.
// `env`: variables the service runs with; `osEnv`: this machine's environment (where XDG folders are), passed in by tests.
export function serviceSpec({ platform = process.platform, command, paths, home = os.homedir(), uid = process.getuid?.() ?? 0, env = {}, packaged = false, osEnv = process.env }) {
  if (platform === "linux") {
    const xdgConfig = osEnv.XDG_CONFIG_HOME || path.posix.join(home, ".config");
    const unitDir = path.posix.join(xdgConfig, "systemd", "user");
    return {
      kind: "systemd",
      files: packaged ? [] : [{ path: path.posix.join(unitDir, SERVICE.unit), content: systemdUnit({ command, env }) }],
      install: [["systemctl", ["--user", "daemon-reload"]], ["systemctl", ["--user", "enable", "--now", SERVICE.unit]]],
      start: [["systemctl", ["--user", "start", SERVICE.unit]]],
      stop: [["systemctl", ["--user", "stop", SERVICE.unit]]],
      restart: [["systemctl", ["--user", "restart", SERVICE.unit]]],
      uninstall: [["systemctl", ["--user", "disable", "--now", SERVICE.unit]], ["systemctl", ["--user", "daemon-reload"]]],
      status: ["systemctl", ["--user", "is-active", SERVICE.unit]],
      fallback: { path: path.posix.join(xdgConfig, "autostart", "api-client-agent.desktop"), content: desktopEntry({ command }) },
    };
  }
  if (platform === "darwin") {
    const plist = path.posix.join(home, "Library", "LaunchAgents", `${SERVICE.label}.plist`);
    const target = `gui/${uid}/${SERVICE.label}`;
    return {
      kind: "launchd",
      files: [{ path: plist, content: launchdPlist({ command, logs: paths.logs, env }) }],
      install: [["launchctl", ["bootout", target], { ignore: true }], ["launchctl", ["bootstrap", `gui/${uid}`, plist]], ["launchctl", ["enable", target]]],
      start: [["launchctl", ["kickstart", target]]],
      stop: [["launchctl", ["kill", "SIGTERM", target]]],
      restart: [["launchctl", ["kickstart", "-k", target]]],
      uninstall: [["launchctl", ["bootout", target], { ignore: true }]],
      status: ["launchctl", ["print", target]],
    };
  }
  if (platform === "win32") {
    const launcher = path.win32.join(paths.install, "run-hidden.ps1");
    const psRun = (script) => ["powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded(script)]];
    return {
      kind: "task",
      files: [{ path: launcher, content: windowsLauncher({ command, env }) }],
      install: [psRun(windowsRegisterScript({ launcher }))],
      start: [psRun(`Start-ScheduledTask -TaskName ${ps(SERVICE.task)}`)],
      stop: [psRun(`Stop-ScheduledTask -TaskName ${ps(SERVICE.task)}`)],
      restart: [psRun(`Stop-ScheduledTask -TaskName ${ps(SERVICE.task)}; Start-ScheduledTask -TaskName ${ps(SERVICE.task)}`)],
      uninstall: [psRun(`Stop-ScheduledTask -TaskName ${ps(SERVICE.task)} -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName ${ps(SERVICE.task)} -Confirm:$false`)],
      status: psRun(`(Get-ScheduledTask -TaskName ${ps(SERVICE.task)}).State`),
    };
  }
  throw new Error(`Unsupported system: ${platform} (supported: Linux, macOS, Windows)`);
}

// ---- doing it ----
const run = ([cmd, args, opts = {}]) => {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", windowsHide: true });
  } catch (e) {
    if (opts.ignore) return "";
    throw new Error(`${cmd} ${args[0] ?? ""} failed: ${(e.stderr || e.message || "").toString().trim()}`);
  }
};
const hasSystemdUser = () => {
  try { execFileSync("systemctl", ["--user", "show-environment"], { stdio: "ignore" }); return true; } catch { return false; }
};
const pidFile = (paths) => path.join(paths.config, "agent.pid");
const pidInFile = (paths) => { try { return Number(fs.readFileSync(pidFile(paths), "utf8").trim()) || 0; } catch { return 0; } };
/** The pid of the running agent (from its pid file), or 0. */
export function readPid(paths) {
  const n = pidInFile(paths);
  if (!n) return 0;
  try { process.kill(n, 0); return n; } catch { return 0; }
}
export const writePid = (paths) => { fs.mkdirSync(paths.config, { recursive: true, mode: 0o700 }); fs.writeFileSync(pidFile(paths), String(process.pid), { mode: 0o600 }); };
export const clearPid = (paths) => { if (pidInFile(paths) === process.pid) fs.rmSync(pidFile(paths), { force: true }); };

/** A detached background process (no service manager): used when systemd user services are unavailable. */
function spawnDetached({ command, env }) {
  const child = spawn(command[0], [...command.slice(1), "run"], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ...env } });
  child.unref();
  return child.pid;
}

export function createService(opts) {
  const spec = serviceSpec(opts);
  const linuxFallback = spec.kind === "systemd" && !hasSystemdUser();
  const write = (f) => { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.writeFileSync(f.path, f.content, { mode: 0o644 }); };
  const stopPid = () => {
    const pid = readPid(opts.paths);
    if (pid) try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
    return !!pid;
  };
  return {
    kind: linuxFallback ? "autostart" : spec.kind,
    files: linuxFallback ? [spec.fallback] : spec.files,
    install() {
      if (linuxFallback) {
        write(spec.fallback);
        if (!readPid(opts.paths)) spawnDetached(opts);
        return;
      }
      for (const f of spec.files) write(f);
      for (const c of spec.install) run(c);
    },
    start() {
      if (linuxFallback) { if (!readPid(opts.paths)) spawnDetached(opts); return; }
      for (const c of spec.start) run(c);
    },
    stop() {
      if (!linuxFallback) for (const c of spec.stop) run([...c.slice(0, 2), { ignore: true }]);
      stopPid(); // the process itself, also when it was started by hand
    },
    /** Rewrites the service files of an existing install (after an update) without restarting it. */
    refresh() {
      if (linuxFallback || !spec.files.every((f) => fs.existsSync(f.path))) return false;
      for (const f of spec.files) write(f);
      if (spec.kind === "systemd") run([...spec.install[0], { ignore: true }]); // daemon-reload
      return true;
    },
    restart() {
      if (linuxFallback) { stopPid(); setTimeout(() => spawnDetached(opts), 500); return; }
      for (const c of spec.restart) run(c);
    },
    uninstall() {
      if (linuxFallback) { stopPid(); fs.rmSync(spec.fallback.path, { force: true }); return; }
      for (const c of spec.uninstall) run([...c.slice(0, 2), { ignore: true }]);
      stopPid();
      for (const f of spec.files) fs.rmSync(f.path, { force: true });
    },
    /** "running" | "stopped" | "not installed" */
    status() {
      const files = linuxFallback ? [spec.fallback] : spec.files;
      if (!files.every((f) => fs.existsSync(f.path))) return readPid(opts.paths) ? "running (not installed as a service)" : "not installed";
      if (linuxFallback) return readPid(opts.paths) ? "running" : "stopped";
      const out = run([...spec.status, { ignore: true }]).trim();
      if (spec.kind === "systemd") return out === "active" ? "running" : "stopped";
      if (spec.kind === "launchd") return /state = running/.test(out) ? "running" : "stopped";
      return /Running/i.test(out) ? "running" : "stopped";
    },
  };
}
