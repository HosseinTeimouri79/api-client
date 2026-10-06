import crypto from "node:crypto";
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
  allowPrivateTargets: process.env.ALLOW_PRIVATE_TARGETS === "true", // SSRF guard off-switch (dev only)
  scriptTimeoutMs: Number(process.env.SCRIPT_TIMEOUT_MS || 1500),
  connectAttemptTimeoutMs: Number(
    process.env.CONNECT_ATTEMPT_TIMEOUT_MS || 5000,
  ), // per-address connect budget (Node default is only 250ms)
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  maxResponseBytes: Number(process.env.MAX_RESPONSE_BYTES || 10 * 1024 * 1024),
};
