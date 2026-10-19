import { config } from "../config.js";

// The installers of the latest GitHub release (the CI workflow builds them on every release tag and attaches their
// index.json), so the download links always point to the newest agent. Kept for a while; a failure is kept for less so
// GitHub is not asked on every page load while it is unreachable.
const REPO = /^[\w.-]+\/[\w.-]+$/;
const FILE = /^[\w][\w.-]*$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/; // links shown on the page
const KEEP_MS = 10 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 5000;
let cache = null; // { key, at, ttl, promise }

const get = async (url, accept) => {
  const res = await fetch(url, { headers: { accept, "user-agent": "api-client-server" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

async function fetchRelease(repo) {
  const rel = await get(`${config.githubApi}/repos/${repo}/releases/latest`, "application/vnd.github+json");
  const assets = new Map((rel.assets ?? []).map((a) => [a.name, a]));
  const index = assets.get("index.json");
  if (!index) return null; // not a release with agent installers
  const { files = [] } = await get(index.browser_download_url, "application/octet-stream");
  const list = files
    .filter((f) => FILE.test(f.file ?? "") && HTTPS.test(assets.get(f.file)?.browser_download_url ?? ""))
    .map(({ platform, arch, kind, file, sha256 }) => ({ platform, arch, kind, file, sha256, size: assets.get(file).size, url: assets.get(file).browser_download_url }));
  return list.length ? { version: String(rel.tag_name ?? "").replace(/^v/, ""), url: HTTPS.test(rel.html_url ?? "") ? rel.html_url : null, installers: list } : null;
}

/** The latest release's installers ({ version, url, installers }), or null when it cannot be had (off, offline, none). */
export async function latestRelease() {
  const repo = config.agentReleases;
  if (!REPO.test(repo ?? "")) return null;
  const key = `${config.githubApi} ${repo}`;
  if (cache?.key !== key || Date.now() - cache.at > cache.ttl) {
    const promise = fetchRelease(repo).catch(() => null);
    cache = { key, at: Date.now(), ttl: KEEP_MS, promise };
    promise.then((v) => { if (cache?.promise === promise && !v) cache.ttl = RETRY_MS; });
  }
  return cache.promise;
}
