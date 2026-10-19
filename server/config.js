import crypto from "node:crypto";
import fs from "node:fs";
import { engine } from "../core/config.js";
// The app version lives in package.json (also shown in Settings → About and returned by /healthz).
export const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const repository = () => {
  const { repository: r } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(typeof r === "string" ? r : r?.url ?? "")?.[1] ?? "off";
};
const isProd = process.env.NODE_ENV === "production";
const secret =
  process.env.JWT_SECRET ||
  (isProd ? null : crypto.randomBytes(32).toString("hex"));
if (!secret) throw new Error("JWT_SECRET is required in production");
// The server's settings extend the engine's (core/config.js): `config` and `engine` are the same object, so a change to
// a limit here (tests, admin settings) is what the engine uses.
export const config = Object.assign(engine, {
  isProd,
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || "./data/app.db",
  jwtSecret: secret,
  // Comma-separated usernames promoted to admin on every start (recovery / bootstrap).
  adminUsernames: (process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  scriptTimeoutMs: Number(process.env.SCRIPT_TIMEOUT_MS || 1500),
  // Local mode: requests sent by the Local Agent on the user's own computer (agent/). LOCAL_AGENT=false turns it off.
  localAgent: process.env.LOCAL_AGENT !== "false",
  agentDefaultUrl: process.env.AGENT_DEFAULT_URL || "http://127.0.0.1:47823",
  agentInstallersDir: process.env.AGENT_INSTALLERS_DIR || "", // installers from `npm run build:installers` (default ./build/installers)
  // The GitHub repository whose latest release the download links point to ("owner/name"; "off" uses only this server's
  // installers). Default: the one in package.json.
  agentReleases: process.env.AGENT_RELEASES ?? repository(),
  githubApi: process.env.GITHUB_API_URL || "https://api.github.com",
  // The address users open the app at, for the install scripts (otherwise taken from the request). e.g. https://api.example.com
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
});
