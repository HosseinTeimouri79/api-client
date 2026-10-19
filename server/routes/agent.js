import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config, version } from "../config.js";
import { HttpError } from "../middleware/auth.js";
import { latestRelease } from "../services/agentRelease.js";

// The Local Agent is built with the UI (`npm run build` -> dist/agent/agent.mjs) and handed out by this server, which is
// also where installed agents look for updates. The install scripts are templates with this server's address filled in.
const BUNDLE = fileURLToPath(new URL("../../dist/agent/agent.mjs", import.meta.url));
// installers built by `npm run build:installers` (agent/packaging/build.mjs), described by their index.json
// (in build/installers/, or AGENT_INSTALLERS_DIR: a folder the operator fills, e.g. a Docker volume)
const installersDir = () => path.resolve(config.agentInstallersDir || fileURLToPath(new URL("../../build/installers/", import.meta.url))) + path.sep;
const SCRIPTS = { "install.sh": "text/x-shellscript", "install.ps1": "text/plain" };
const MIN_NODE = "22.13.0";
let cached = null; // { mtimeMs, size, sha256 }
function bundle() {
  let st;
  try { st = fs.statSync(BUNDLE); } catch { return null; }
  if (cached?.mtimeMs !== st.mtimeMs) cached = { mtimeMs: st.mtimeMs, size: st.size, sha256: crypto.createHash("sha256").update(fs.readFileSync(BUNDLE)).digest("hex") };
  return cached;
}
let index = null; // { dir, mtimeMs, files }
function installers() {
  const dir = installersDir();
  let st;
  try { st = fs.statSync(dir + "index.json"); } catch { return []; }
  if (index?.dir !== dir || index.mtimeMs !== st.mtimeMs) {
    let files = [];
    try { files = JSON.parse(fs.readFileSync(dir + "index.json", "utf8")).files ?? []; } catch { /* rebuilt meanwhile */ }
    // plain file names only, and only files that are there
    index = { dir, mtimeMs: st.mtimeMs, files: files.filter((f) => /^[\w][\w.-]*$/.test(f.file ?? "") && fs.existsSync(dir + f.file)) };
  }
  return index.files.map((f) => ({ ...f, url: `/agent/download/${f.file}` }));
}
export const agentManifest = () => {
  const b = bundle();
  if (!b) return null;
  const files = installers();
  // what an installed standalone agent downloads to update itself (the program, or the archive it is in)
  const binaries = Object.fromEntries(files.filter((f) => ["exe", "zip", "tar.gz"].includes(f.kind)).map((f) => [`${f.platform}-${f.arch}`, { file: f.url, sha256: f.sha256, kind: f.kind }]));
  return { name: "api-client-agent", version, file: "/agent/agent.mjs", sha256: b.sha256, size: b.size, minNode: MIN_NODE, installers: files, binaries };
};
// Only a plain origin goes into a script (it ends up inside quotes in sh and PowerShell).
const ORIGIN = /^https?:\/\/(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
export function serverOrigin(req) {
  const o = config.publicUrl || `${req.protocol}://${req.get("host")}`;
  if (!ORIGIN.test(o)) throw new HttpError(400, "Cannot tell this server's address; set PUBLIC_URL");
  return o;
}

/** Public: manifest, the agent itself and the install scripts (no account needed to download them). */
export function agentDownloadsRouter() {
  const r = Router();
  r.use((_req, _res, next) => next(config.localAgent ? undefined : new HttpError(404, "Not found")));
  r.get("/manifest.json", (_req, res, next) => {
    const m = agentManifest();
    if (!m) return next(new HttpError(404, "The Local Agent is not built on this server (npm run build)"));
    res.set("Cache-Control", "no-cache").json(m);
  });
  r.get("/agent.mjs", (_req, res, next) => {
    if (!bundle()) return next(new HttpError(404, "The Local Agent is not built on this server (npm run build)"));
    res.set({ "Content-Type": "text/javascript; charset=utf-8", "Content-Disposition": 'attachment; filename="agent.mjs"', "Cache-Control": "no-cache" });
    res.sendFile(BUNDLE);
  });
  r.get("/download/:file", (req, res, next) => {
    const f = installers().find((x) => x.file === req.params.file); // only files listed in index.json
    if (!f) return next(new HttpError(404, "Not found"));
    res.set({ "Content-Disposition": `attachment; filename="${f.file}"`, "Cache-Control": "no-cache", "X-Content-SHA256": f.sha256 });
    res.sendFile(installersDir() + f.file, { headers: { "Content-Type": "application/octet-stream" } });
  });
  r.get("/:script", (req, res, next) => {
    const type = SCRIPTS[req.params.script];
    if (!type) return next();
    const text = fs.readFileSync(new URL(`../../agent/install/${req.params.script}`, import.meta.url), "utf8").replaceAll("__SERVER__", serverOrigin(req));
    res.set({ "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-cache" }).send(text);
  });
  return r;
}

/** Signed in: what the UI needs to offer Local mode (is it on, which agent version goes with this server, how to install). */
export function agentInfoRouter() {
  const r = Router();
  r.get("/", (req, res) => {
    const m = config.localAgent ? agentManifest() : null;
    res.json({
      enabled: config.localAgent, version, available: !!m, sha256: m?.sha256 ?? null, defaultUrl: config.agentDefaultUrl,
      server: config.localAgent ? serverOrigin(req) : null,
      installers: (m?.installers ?? []).map(({ platform, arch, kind, url, size, sha256 }) => ({ platform, arch, kind, url, size, sha256 })),
    });
  });
  // the installers of the latest GitHub release (null: use this server's own, above)
  r.get("/release", async (_req, res) => res.json(config.localAgent ? await latestRelease() : null));
  return r;
}
