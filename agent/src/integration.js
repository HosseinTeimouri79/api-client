import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * What an installed program is expected to have on each system, for the current user only (no administrator rights):
 *  - Windows: an entry in Settings → Apps → Installed apps (with Uninstall), and the program folder on the user's PATH;
 *  - Linux / macOS: the `api-client-agent` command in ~/.local/bin;
 *  - everywhere: a shortcut that opens the agent's page (`ui`): Start menu on Windows, the applications menu on Linux,
 *    ~/Applications/API Client Agent.app on macOS.
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

export const SHORTCUT_NAME = "API Client Agent";
const psRun = (script) => ["powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]];

/**
 * The shortcut that opens the agent's page, per system: files to write (`files`, with `mode`), folders to remove on
 * uninstall (`remove`), commands to run (`install` / `uninstall`). `icon`: the PNG to show (Linux).
 */
export function shortcutSpec({ platform = process.platform, command, dir, home = os.homedir(), osEnv = process.env, icon = null }) {
  const args = [...command.slice(1), "ui"];
  if (platform === "win32") {
    const lnk = `(Join-Path ([Environment]::GetFolderPath('Programs')) ${ps(`${SHORTCUT_NAME}.lnk`)})`;
    const quoteArg = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    return {
      files: [], remove: [],
      install: [psRun([
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${lnk})`,
        `$s.TargetPath = ${ps(command[0])}`,
        `$s.Arguments = ${ps(args.map(quoteArg).join(" "))}`,
        `$s.WorkingDirectory = ${ps(dir)}`,
        `$s.IconLocation = ${ps(`${command.at(-1).endsWith(".exe") ? command.at(-1) : command[0]},0`)}`,
        "$s.WindowStyle = 7", // minimized: the console window of the command is not in the way
        "$s.Description = 'Status and settings of the API Client Local Agent'",
        "$s.Save()",
      ].join("; "))],
      uninstall: [psRun(`Remove-Item -LiteralPath ${lnk} -Force -ErrorAction SilentlyContinue`)],
    };
  }
  if (platform === "darwin") {
    // a minimal application bundle whose program is a shell script: Finder, Launchpad and Spotlight list it
    const app = path.posix.join(home, "Applications", `${SHORTCUT_NAME}.app`);
    const q = (x) => `'${String(x).replace(/'/g, "'\\''")}'`;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleName</key><string>${SHORTCUT_NAME}</string>
    <key>CFBundleDisplayName</key><string>${SHORTCUT_NAME}</string>
    <key>CFBundleIdentifier</key><string>com.apiclient.agent.ui</string>
    <key>CFBundleExecutable</key><string>open-agent</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>LSUIElement</key><true/>
  </dict>
</plist>
`;
    return {
      files: [
        { path: path.posix.join(app, "Contents", "Info.plist"), content: plist, mode: 0o644 },
        { path: path.posix.join(app, "Contents", "MacOS", "open-agent"), content: `#!/bin/sh\nexec ${[...command, "ui"].map(q).join(" ")}\n`, mode: 0o755 },
      ],
      remove: [app], install: [], uninstall: [],
    };
  }
  const apps = path.posix.join(osEnv.XDG_DATA_HOME || path.posix.join(home, ".local", "share"), "applications");
  const q = (x) => `"${String(x).replace(/(["`$\\])/g, "\\$1")}"`;
  const iconFile = icon ? path.posix.join(dir, "icon.png") : null;
  return {
    files: [
      ...(icon ? [{ path: iconFile, content: icon, mode: 0o644 }] : []),
      { path: path.posix.join(apps, "api-client-agent.desktop"), mode: 0o644, content: [
        "[Desktop Entry]", "Type=Application", `Name=${SHORTCUT_NAME}`, "Comment=Status and settings of the API Client Local Agent",
        `Exec=${[...command, "ui"].map(q).join(" ")}`, ...(iconFile ? [`Icon=${iconFile}`] : []), "Terminal=false", "Categories=Network;Development;", "",
      ].join("\n") },
    ],
    remove: [], install: [], uninstall: [],
  };
}

const run = ([cmd, args, opts = {}]) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore", windowsHide: true });
  } catch (e) {
    if (!opts.ignore) throw new Error(`${cmd} ${args[0]} failed: ${e.message}`);
  }
};

function applyShortcut(opts) {
  try {
    const spec = shortcutSpec(opts);
    for (const f of spec.files) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.content, { mode: f.mode });
      fs.chmodSync(f.path, f.mode);
    }
    for (const c of spec.install) run(c);
    return opts.platform === "win32" ? `Start menu: ${SHORTCUT_NAME}` : opts.platform === "darwin" ? `Applications: ${SHORTCUT_NAME}` : `Applications menu: ${SHORTCUT_NAME}`;
  } catch (e) {
    return `(could not add the ${SHORTCUT_NAME} shortcut: ${e.message})`;
  }
}

/** Returns a note for the user (where the command and the shortcut are), never throws: the agent works without these extras. */
export function applyIntegration({ platform = process.platform, command, dir, version, icon = null }) {
  const shortcut = applyShortcut({ platform, command, dir, icon });
  return `${commandIntegration({ platform, command, dir, version })}\nOpen the agent's page from: ${shortcut} (or: api-client-agent ui)`;
}
function commandIntegration({ platform, command, dir, version }) {
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
    const spec = shortcutSpec({ platform, command, dir });
    for (const c of spec.uninstall) run([...c, { ignore: true }]);
    for (const f of spec.files) if (!f.path.startsWith(dir)) fs.rmSync(f.path, { force: true });
    for (const d of spec.remove) fs.rmSync(d, { recursive: true, force: true });
  } catch { /* nothing to remove */ }
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
