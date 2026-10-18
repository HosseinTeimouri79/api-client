import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * What an installed program is expected to have on each system, for the current user only (no administrator rights):
 *  - Windows: an entry in Settings → Apps → Installed apps (with Uninstall), and the program folder on the user's PATH;
 *  - Linux / macOS: the `api-client-agent` command in ~/.local/bin.
 * The `*Spec` functions are pure (tested on every system); `applyIntegration` / `removeIntegration` do the work.
 */
export const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ApiClientAgent";
const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function windowsIntegrationSpec({ exe, dir, version, sizeKb = 0 }) {
  const add = (name, type, data) => ["reg", ["add", UNINSTALL_KEY, "/v", name, "/t", type, "/d", String(data), "/f"]];
  const pathScript = (op) => [
    "$dir = " + ps(dir),
    "$cur = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$parts = @($cur -split ';' | Where-Object { $_ -and ($_ -ne $dir) })",
    op === "add" ? "$parts += $dir" : "",
    "[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')",
  ].filter(Boolean).join("; ");
  const psRun = (script) => ["powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]];
  return {
    install: [
      add("DisplayName", "REG_SZ", "API Client Agent"),
      add("DisplayVersion", "REG_SZ", version),
      add("Publisher", "REG_SZ", "API Client"),
      add("InstallLocation", "REG_SZ", dir),
      add("DisplayIcon", "REG_SZ", exe),
      add("UninstallString", "REG_SZ", `"${exe}" uninstall --pause`),
      add("QuietUninstallString", "REG_SZ", `"${exe}" uninstall`),
      add("URLInfoAbout", "REG_SZ", "https://github.com/HosseinTeimouri79/api-client#local-agent"),
      add("NoModify", "REG_DWORD", 1),
      add("NoRepair", "REG_DWORD", 1),
      add("EstimatedSize", "REG_DWORD", sizeKb),
      psRun(pathScript("add")),
    ],
    uninstall: [["reg", ["delete", UNINSTALL_KEY, "/f"], { ignore: true }], psRun(pathScript("remove"))],
  };
}

/** ~/.local/bin/api-client-agent: a link to the executable, or a small shell script that starts the script with Node. */
export function unixIntegrationSpec({ command, home = os.homedir() }) {
  const link = path.posix.join(home, ".local", "bin", "api-client-agent");
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  return command.length === 1
    ? { link, target: command[0] }
    : { link, script: `#!/bin/sh\nexec ${command.map(q).join(" ")} "$@"\n` };
}

const run = ([cmd, args, opts = {}]) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore", windowsHide: true });
  } catch (e) {
    if (!opts.ignore) throw new Error(`${cmd} ${args[0]} failed: ${e.message}`);
  }
};

/** Returns a note for the user (where the command is), never throws: the agent works without these extras. */
export function applyIntegration({ platform = process.platform, command, dir, version }) {
  try {
    if (platform === "win32") {
      const exe = command.length === 1 ? command[0] : command[1];
      const sizeKb = Math.round(fs.statSync(exe).size / 1024);
      for (const c of windowsIntegrationSpec({ exe, dir, version, sizeKb }).install) run(c);
      return `Listed in Settings → Apps → Installed apps; "api-client-agent" works in new terminals.`;
    }
    const spec = unixIntegrationSpec({ command });
    fs.mkdirSync(path.dirname(spec.link), { recursive: true });
    fs.rmSync(spec.link, { force: true });
    if (spec.target) fs.symlinkSync(spec.target, spec.link);
    else fs.writeFileSync(spec.link, spec.script, { mode: 0o755 });
    const onPath = (process.env.PATH ?? "").split(path.delimiter).includes(path.dirname(spec.link));
    return onPath ? `Command: api-client-agent (${spec.link})` : `Command: ${spec.link} (add ~/.local/bin to your PATH to type just "api-client-agent")`;
  } catch (e) {
    return `(could not add the api-client-agent command: ${e.message})`;
  }
}

export function removeIntegration({ platform = process.platform, command, dir, version }) {
  try {
    if (platform === "win32") {
      for (const c of windowsIntegrationSpec({ exe: command.at(-1), dir, version }).uninstall) run(c);
      return;
    }
    const { link } = unixIntegrationSpec({ command });
    const st = fs.lstatSync(link, { throwIfNoEntry: false });
    // only our own link or script
    if (st && (st.isSymbolicLink() || fs.readFileSync(link, "utf8").includes("api-client-agent") || fs.readFileSync(link, "utf8").includes("agent.mjs"))) fs.rmSync(link, { force: true });
  } catch { /* nothing to remove */ }
}
