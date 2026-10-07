import crypto from "node:crypto";
import fs from "node:fs";
// The app version lives in package.json (also shown in Settings → About and returned by /healthz).
export const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const isProd = process.env.NODE_ENV === "production";
const secret =
  process.env.JWT_SECRET ||
  (isProd ? null : crypto.randomBytes(32).toString("hex"));
if (!secret) throw new Error("JWT_SECRET is required in production");
export const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || "./data/app.db",
  jwtSecret: secret,
  // Comma-separated usernames promoted to admin on every start (recovery / bootstrap).
  adminUsernames: (process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  allowPrivateTargets: process.env.ALLOW_PRIVATE_TARGETS === "true", // SSRF guard off-switch (dev only)
  scriptTimeoutMs: Number(process.env.SCRIPT_TIMEOUT_MS || 1500),
  connectAttemptTimeoutMs: Number(
    process.env.CONNECT_ATTEMPT_TIMEOUT_MS || 5000,
  ), // per-address connect budget (Node default is only 250ms)
  // Defaults used when a run does not ask for its own limits (users can set theirs in Settings).
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  maxResponseBytes: Number(process.env.MAX_RESPONSE_BYTES || 10 * 1024 * 1024),
  // Ceilings for those per-user limits ("0 = no limit" in Settings means "up to this"); 0 here lifts the ceiling.
  maxRequestTimeoutMs: Number(process.env.MAX_REQUEST_TIMEOUT_MS || 600000),
  maxResponseBytesLimit: Number(process.env.MAX_RESPONSE_BYTES_LIMIT || 100 * 1024 * 1024),
};
