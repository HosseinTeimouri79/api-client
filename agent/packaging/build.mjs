#!/usr/bin/env node
// Builds the Local Agent's installers: a standalone executable per system (Node.js built in, so users need nothing
// else) packed the way each system expects. Runs on Linux or macOS:
//
//   npm run build:installers                        all targets
//   npm run build:installers -- --targets linux-x64,win32-x64
//
// Output in build/installers/ or $AGENT_INSTALLERS_DIR (served by the API Client server under /agent/download/ and listed in Settings):
//   api-client-agent-setup-<v>-windows-x64.exe   double-click: installs for the current user, no administrator rights
//   api-client-agent-<v>-macos-arm64.zip / -x64  the program; opening it installs it (ad-hoc signed, see README)
//   api-client-agent_<v>_amd64.deb / _arm64.deb  Debian / Ubuntu package
//   api-client-agent-<v>-linux-x64.tar.gz / -arm64  the program for other distributions
//   index.json                                   what was built, with SHA-256 and size
//
// How: the agent is bundled to one CommonJS file, turned into a Node.js "single executable application" blob, and the
// blob is injected (postject) into the official Node.js binary of each system, downloaded from nodejs.org and checked
// against its SHASUMS256.txt. macOS binaries are signed ad hoc (codesign on a Mac, rcodesign elsewhere).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inject } from "postject";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;
const NODE = process.version; // the blob must be made by the same Node.js version it is injected into
const CACHE = path.join(ROOT, ".cache", "agent-build");
// not under dist/: `npm run build` empties dist/, and installers take a while to make
const OUT = path.resolve(process.env.AGENT_INSTALLERS_DIR || path.join(ROOT, "build", "installers"));
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const RCODESIGN = { version: "0.29.0", url: "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz" };

// <platform>-<arch> as Node.js names them -> nodejs.org file and our package names
const TARGETS = {
  "linux-x64": { dist: `node-${NODE}-linux-x64.tar.xz`, bin: `node-${NODE}-linux-x64/bin/node`, deb: "amd64", label: "linux-x64" },
  "linux-arm64": { dist: `node-${NODE}-linux-arm64.tar.xz`, bin: `node-${NODE}-linux-arm64/bin/node`, deb: "arm64", label: "linux-arm64" },
  "darwin-x64": { dist: `node-${NODE}-darwin-x64.tar.xz`, bin: `node-${NODE}-darwin-x64/bin/node`, label: "macos-x64" },
  "darwin-arm64": { dist: `node-${NODE}-darwin-arm64.tar.xz`, bin: `node-${NODE}-darwin-arm64/bin/node`, label: "macos-arm64" },
  "win32-x64": { dist: `node-${NODE}-win-x64.zip`, bin: `node-${NODE}-win-x64/node.exe`, label: "windows-x64" },
};

const args = process.argv.slice(2);
const pick = args.includes("--targets") ? args[args.indexOf("--targets") + 1].split(",") : Object.keys(TARGETS);
for (const t of pick) if (!TARGETS[t]) throw new Error(`Unknown target ${t} (known: ${Object.keys(TARGETS).join(", ")})`);

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"], ...opts });
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const log = (m) => console.log(`[installers] ${m}`);
async function download(url, file) {
  if (fs.existsSync(file)) return file;
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
  return file;
}

// 1. the agent as one CommonJS file, then the SEA blob
log(`agent ${VERSION}, Node.js ${NODE}`);
fs.mkdirSync(CACHE, { recursive: true });
sh(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--config", path.join(ROOT, "agent/vite.config.js")], { env: { ...process.env, AGENT_FORMAT: "cjs" }, stdio: "inherit" });
const blob = path.join(CACHE, "agent.blob");
fs.writeFileSync(path.join(CACHE, "sea-config.json"), JSON.stringify({
  main: path.join(ROOT, "dist/agent/agent.cjs"), output: blob,
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, // portable: one blob for every system
}));
sh(process.execPath, ["--experimental-sea-config", path.join(CACHE, "sea-config.json")], { stdio: "inherit" });

// 2. official Node.js binaries, checked against nodejs.org's SHASUMS256.txt
const sums = fs.readFileSync(await download(`https://nodejs.org/dist/${NODE}/SHASUMS256.txt`, path.join(CACHE, NODE, "SHASUMS256.txt")), "utf8");
async function nodeBinary(target) {
  const t = TARGETS[target];
  const archive = await download(`https://nodejs.org/dist/${NODE}/${t.dist}`, path.join(CACHE, NODE, t.dist));
  const want = sums.split("\n").find((l) => l.endsWith(`  ${t.dist}`))?.split(" ")[0];
  if (!want || want !== sha256(archive)) { fs.rmSync(archive); throw new Error(`${t.dist}: checksum does not match nodejs.org's SHASUMS256.txt`); }
  const dir = path.join(CACHE, NODE, target);
  if (!fs.existsSync(path.join(dir, t.bin))) {
    fs.mkdirSync(dir, { recursive: true });
    if (t.dist.endsWith(".zip")) sh("unzip", ["-q", "-o", archive, t.bin, "-d", dir]);
    else sh("tar", ["-xJf", archive, "-C", dir, t.bin]);
  }
  return path.join(dir, t.bin);
}

// 3. macOS signatures: injecting changes the binary, and Apple Silicon runs only signed code (ad hoc is enough)
let signer = null;
async function adhocSign(file) {
  if (process.platform === "darwin") return sh("codesign", ["--sign", "-", "--force", file]);
  if (!signer) {
    signer = process.env.RCODESIGN || (() => { try { return sh("sh", ["-c", "command -v rcodesign"]).toString().trim(); } catch { return ""; } })();
    if (!signer) {
      const tgz = await download(RCODESIGN.url, path.join(CACHE, path.basename(RCODESIGN.url)));
      const want = (await (await fetch(`${RCODESIGN.url}.sha256`)).text()).trim().split(/\s+/)[0];
      if (want !== sha256(tgz)) throw new Error("rcodesign download: checksum mismatch");
      sh("tar", ["-xzf", tgz, "-C", CACHE]);
      signer = fs.readdirSync(CACHE, { recursive: true }).map(String).map((p) => path.join(CACHE, p)).find((p) => path.basename(p) === "rcodesign");
    }
  }
  sh(signer, ["sign", file], { stdio: "ignore" });
}

// 4. per target: inject, sign, pack
const README = (target) => `API Client Local Agent ${VERSION}

The agent sends API Client's requests from this computer, so they can reach localhost and your local network.
Node.js is built in; nothing else is needed.

Install: ${target.startsWith("darwin") ? "double-click api-client-agent (it is not notarized by Apple: if macOS blocks it, use System Settings → Privacy & Security → Open Anyway)," : "run ./api-client-agent (or double-click it),"}
then type the address of your API Client and, in API Client, the pairing code it shows
(header: Server / Local switch → Local).

It installs for your user only (no administrator rights) and starts when you log in.
Later: api-client-agent status | pair | update | uninstall      (help: api-client-agent help)
Documentation: ${PKG.homepage.replace("#readme", "")}#local-agent
`;
// only the targets being built are replaced; installers of the other systems (same version) stay listed
fs.mkdirSync(OUT, { recursive: true });
const previous = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8")); } catch { return null; } })();
const isPicked = (f) => pick.includes(`${f.platform}-${f.arch}`);
const kept = previous?.version === VERSION ? previous.files.filter((f) => !isPicked(f) && fs.existsSync(path.join(OUT, f.file))) : [];
for (const f of previous?.files ?? []) if (!kept.includes(f)) fs.rmSync(path.join(OUT, path.basename(f.file)), { force: true });
const built = [];
const add = (target, kind, file, extra = {}) => built.push({ platform: target.split("-")[0], arch: target.split("-")[1], kind, file: path.basename(file), size: fs.statSync(file).size, sha256: sha256(file), ...extra });

for (const target of pick) {
  const t = TARGETS[target];
  const work = path.join(CACHE, "work", target);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const exe = path.join(work, target.startsWith("win32") ? "api-client-agent.exe" : "api-client-agent");
  fs.copyFileSync(await nodeBinary(target), exe);
  fs.chmodSync(exe, 0o755);
  log(`${target}: injecting`);
  await inject(exe, "NODE_SEA_BLOB", fs.readFileSync(blob), { sentinelFuse: FUSE, ...(target.startsWith("darwin") && { machoSegmentName: "NODE_SEA" }) });
  if (target.startsWith("darwin")) await adhocSign(exe);

  if (target.startsWith("win32")) {
    const setup = path.join(OUT, `api-client-agent-setup-${VERSION}-${t.label}.exe`);
    fs.copyFileSync(exe, setup);
    add(target, "exe", setup, { installer: "setup" });
    continue;
  }
  fs.writeFileSync(path.join(work, "README.txt"), README(target));
  if (target.startsWith("darwin")) {
    const zip = path.join(OUT, `api-client-agent-${VERSION}-${t.label}.zip`);
    sh("zip", ["-q", "-X", zip, "api-client-agent", "README.txt"], { cwd: work });
    add(target, "zip", zip, { installer: "zip" });
    continue;
  }
  const tgz = path.join(OUT, `api-client-agent-${VERSION}-${t.label}.tar.gz`);
  sh("tar", ["-czf", tgz, "--owner=0", "--group=0", "-C", work, "api-client-agent", "README.txt"]);
  add(target, "tar.gz", tgz, { installer: "tar.gz" });
  built.push({ ...(await debPackage(target, exe)) });
}

/** A Debian package: /usr/lib/api-client-agent/api-client-agent, /usr/bin link, a systemd *user* unit for every user. */
async function debPackage(target, exe) {
  const t = TARGETS[target];
  const root = path.join(CACHE, "work", `${target}-deb`);
  fs.rmSync(root, { recursive: true, force: true });
  const p = (...x) => path.join(root, ...x);
  for (const d of ["DEBIAN", "usr/lib/api-client-agent", "usr/bin", "usr/lib/systemd/user", "usr/share/doc/api-client-agent"]) fs.mkdirSync(p(d), { recursive: true });
  fs.copyFileSync(exe, p("usr/lib/api-client-agent/api-client-agent"));
  fs.chmodSync(p("usr/lib/api-client-agent/api-client-agent"), 0o755);
  fs.symlinkSync("../lib/api-client-agent/api-client-agent", p("usr/bin/api-client-agent"));
  const { systemdUnit } = await import("../src/service.js");
  fs.writeFileSync(p("usr/lib/systemd/user/api-client-agent.service"), systemdUnit({ command: ["/usr/lib/api-client-agent/api-client-agent"] }));
  fs.copyFileSync(path.join(ROOT, "LICENSE"), p("usr/share/doc/api-client-agent/copyright"));
  fs.writeFileSync(p("usr/share/doc/api-client-agent/README"), README(target));
  const size = Math.ceil(fs.statSync(exe).size / 1024);
  fs.writeFileSync(p("DEBIAN/control"), [
    "Package: api-client-agent",
    `Version: ${VERSION}`,
    `Architecture: ${t.deb}`,
    `Maintainer: ${process.env.DEB_MAINTAINER || `API Client <${PKG.bugs.url}>`}`,
    `Installed-Size: ${size}`,
    "Section: net",
    "Priority: optional",
    `Homepage: ${PKG.homepage.replace("#readme", "")}`,
    "Description: API Client Local Agent",
    " Sends API Client's requests from this computer, so they can reach localhost and the",
    " local network. Runs per user in the background (systemd user service); Node.js is built in.",
    "",
  ].join("\n"));
  fs.writeFileSync(p("DEBIAN/postinst"), `#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  echo
  echo "API Client Local Agent installed. As your normal user (not root), run:"
  echo
  echo "    api-client-agent setup"
  echo
  echo "It asks for your API Client's address, starts the agent at login and shows a pairing code."
fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(p("DEBIAN/prerm"), `#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  # stop the agent of every logged-in user; their settings in ~/.config/api-client-agent stay
  for uid in $(loginctl list-users --no-legend 2>/dev/null | awk '{print $1}'); do
    systemctl --machine="$uid@.host" --user disable --now api-client-agent.service >/dev/null 2>&1 || true
  done
fi
exit 0
`, { mode: 0o755 });
  // modes as Debian expects, whatever this machine's umask is: 755 for folders and programs, 644 for the rest
  fs.chmodSync(root, 0o755);
  for (const rel of fs.readdirSync(root, { recursive: true }).map(String)) {
    const full = p(rel), st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    fs.chmodSync(full, st.isDirectory() || rel.endsWith("api-client-agent/api-client-agent") || /^DEBIAN\/(postinst|prerm)$/.test(rel) ? 0o755 : 0o644);
  }
  const deb = path.join(OUT, `api-client-agent_${VERSION}_${t.deb}.deb`);
  sh("dpkg-deb", ["--root-owner-group", "-Zxz", "--build", root, deb], { stdio: ["ignore", "ignore", "inherit"] });
  return { platform: "linux", arch: target.split("-")[1], kind: "deb", file: path.basename(deb), size: fs.statSync(deb).size, sha256: sha256(deb), installer: "deb" };
}

fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ version: VERSION, node: NODE, builtAt: new Date().toISOString(), files: [...kept, ...built] }, null, 2) + "\n");
for (const b of built) log(`${b.file}  ${(b.size / 1048576).toFixed(1)} MB  sha256 ${b.sha256}`);
