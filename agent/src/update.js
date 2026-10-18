import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Updates come from the API Client server the agent was installed from: GET <server>/agent/manifest.json names the
 * version and, per kind of install, the file and its SHA-256:
 *  - the script (agent.mjs, run with Node.js): `file` / `sha256`;
 *  - the standalone executable (Node.js built in): `binaries["<platform>-<arch>"]` = { file, sha256, kind } where kind is
 *    "exe" (the file is the program) or "tar.gz" / "zip" (the program is `api-client-agent` inside).
 * The download is checked against that hash (and against `--sha256` when given out of band) and replaces the program
 * atomically. The service is then restarted by the caller.
 */
export const compareVersions = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => Number(x) || 0), pb = String(b).split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  return 0;
};
const nodeOk = (min) => compareVersions(process.versions.node, min || "0") >= 0;
const SHA = /^[0-9a-f]{64}$/;

export async function fetchManifest(server, { fetchImpl = fetch } = {}) {
  const base = new URL(server);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error(`Not an http(s) server address: ${server}`);
  const res = await fetchImpl(new URL("/agent/manifest.json", base), { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The server answered ${res.status} for the agent manifest`);
  const m = await res.json();
  if (!m || typeof m.version !== "string" || !SHA.test(m.sha256 ?? "") || typeof m.file !== "string")
    throw new Error("The server's agent manifest is not valid");
  return { ...m, url: new URL(m.file, base).toString() };
}

/** The file this install needs: the script, or the standalone program for this system. */
export function pickAsset(manifest, { standalone, platform = process.platform, arch = process.arch }) {
  if (!standalone) return { url: manifest.url, sha256: manifest.sha256, kind: "script" };
  const a = manifest.binaries?.[`${platform}-${arch}`];
  if (!a || !SHA.test(a.sha256 ?? "") || typeof a.file !== "string") throw new Error(`The server offers no standalone agent for ${platform}-${arch}`);
  return { url: new URL(a.file, manifest.url).toString(), sha256: a.sha256, kind: a.kind ?? "exe" };
}

/** { available, current, latest, manifest } */
export async function checkForUpdate({ server, current, fetchImpl }) {
  const manifest = await fetchManifest(server, { fetchImpl });
  return { available: compareVersions(manifest.version, current) > 0, current, latest: manifest.version, manifest };
}

/** The program out of a downloaded archive (system tar: GNU tar, bsdtar on macOS, tar.exe on Windows 10+). */
function extractProgram(buf, kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-client-agent-update-"));
  try {
    const file = path.join(dir, `download.${kind}`);
    fs.writeFileSync(file, buf);
    execFileSync("tar", ["-xf", file, "-C", dir], { stdio: "ignore" });
    const name = process.platform === "win32" ? "api-client-agent.exe" : "api-client-agent";
    const found = fs.readdirSync(dir, { recursive: true }).map(String).find((p) => path.basename(p) === name);
    if (!found) throw new Error(`The download has no ${name}`);
    return fs.readFileSync(path.join(dir, found));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Puts `buf` in place of `target` without a moment where neither exists. */
export function replaceFile(target, buf, { platform = process.platform, mode = 0o755 } = {}) {
  const tmp = path.join(path.dirname(target), `.agent.${process.pid}.new`);
  fs.writeFileSync(tmp, buf, { mode });
  if (platform === "win32" && fs.existsSync(target)) {
    // a running .exe cannot be overwritten, but it can be renamed; the old copy is removed on the next start
    fs.rmSync(`${target}.old`, { force: true });
    fs.renameSync(target, `${target}.old`);
  }
  fs.renameSync(tmp, target); // atomic on the same volume; a running process keeps its loaded copy
}

/** Downloads and installs the server's agent. Returns the installed version. */
export async function applyUpdate({ server, target, current, expectSha256, force = false, standalone = false, fetchImpl = fetch }) {
  const { manifest, available } = await checkForUpdate({ server, current, fetchImpl });
  if (!available && !force) return { updated: false, version: current };
  if (!standalone && !nodeOk(manifest.minNode)) throw new Error(`Version ${manifest.version} needs Node.js ${manifest.minNode} or newer (this is ${process.versions.node})`);
  const asset = pickAsset(manifest, { standalone });
  if (expectSha256 && expectSha256.toLowerCase() !== asset.sha256) throw new Error("The SHA-256 you gave does not match the server's manifest");
  if (new URL(asset.url).origin !== new URL(server).origin) throw new Error("The manifest points to another server; refusing to download from it");
  const res = await fetchImpl(asset.url, { redirect: "error", signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 512 * 1024 * 1024) throw new Error("The download is larger than an agent can be");
  const got = crypto.createHash("sha256").update(buf).digest("hex");
  if (got !== asset.sha256) throw new Error(`Checksum mismatch: expected ${asset.sha256}, got ${got}; nothing was changed`);
  replaceFile(target, asset.kind === "tar.gz" || asset.kind === "zip" ? extractProgram(buf, asset.kind) : buf, { mode: asset.kind === "script" ? 0o644 : 0o755 });
  return { updated: true, version: manifest.version, previous: current };
}
