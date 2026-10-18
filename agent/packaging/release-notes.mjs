#!/usr/bin/env node
// The GitHub Release text for this version: how to install the agent from the attached files, then the CHANGELOG entry.
//   node agent/packaging/release-notes.mjs > notes.md      (the release workflow does this)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const v = pkg.version;
const OUT = path.resolve(process.env.AGENT_INSTALLERS_DIR || path.join(ROOT, "build", "installers"));
const files = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8")).files;
const cl = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const start = cl.indexOf(`## [${v}]`);
if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${v}`);
const next = cl.indexOf("\n## [", start + 1);
const entry = cl.slice(cl.indexOf("\n", start) + 1, next < 0 ? undefined : next).trim();
const f = (platform, kind, arch) => files.find((x) => x.platform === platform && x.kind === kind && (!arch || x.arch === arch))?.file;
const code = (name) => (name ? `\`${name}\`` : "–");
const rows = [
  ["Windows 10/11 (x64)", `${code(f("win32", "exe"))}: double-click`],
  ["macOS, Apple Silicon", `${code(f("darwin", "zip", "arm64"))}: unzip, open \`api-client-agent\``],
  ["macOS, Intel", code(f("darwin", "zip", "x64"))],
  ["Debian / Ubuntu", `${code(f("linux", "deb", "x64"))} / ${code(f("linux", "deb", "arm64"))}: \`sudo apt install ./<file>.deb\`, then \`api-client-agent setup\``],
  ["Other Linux", `${code(f("linux", "tar.gz", "x64"))} / ${code(f("linux", "tar.gz", "arm64"))}: extract, run \`./api-client-agent\``],
];
const repo = pkg.homepage.replace("#readme", "");
process.stdout.write(`## Local Agent installers

Node.js is built in: nothing else to install, and no administrator rights are needed (the agent is installed for the current user and starts at login).

| System | File |
| --- | --- |
${rows.map(([a, b]) => `| ${a} | ${b} |`).join("\n")}

Setup asks for your API Client address and shows a pairing code; in API Client choose **Server / Local → Local** and type it.
Server operators: put all files of this release (with \`index.json\`) into \`AGENT_INSTALLERS_DIR\` to offer them in **Settings → Local Agent**.
Checksums: \`SHA256SUMS.txt\`.

> The installers are not code-signed or notarized: Windows SmartScreen asks to confirm (More info → Run anyway); macOS needs System Settings → Privacy & Security → Open Anyway the first time.

${entry}

Full documentation: [README → Local Agent](${repo}#local-agent)
`);
