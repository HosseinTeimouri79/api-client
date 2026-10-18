// The request engine's settings: limits, timeouts, live sessions, the SSRF switch. Defaults come from the environment;
// the server's settings (server/config.js) extend this same object, and the Local Agent replaces the values it owns
// with `configureEngine` at start. Nothing here depends on the server (no secrets, no package.json).

// "40000-40100,50000" -> [[40000, 40100], [50000, 50000]]: the local UDP ports a user may listen on (empty = listening is off)
export const portRanges = (v = "") =>
  v.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [a, b = a] = x.split("-").map(Number); return [a, b]; })
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= 65535 && a <= b);

const env = process.env;
export const engine = {
  allowPrivateTargets: env.ALLOW_PRIVATE_TARGETS === "true", // SSRF guard off-switch (private installs only)
  connectAttemptTimeoutMs: Number(env.CONNECT_ATTEMPT_TIMEOUT_MS || 5000), // per-address connect budget (Node's default is 250ms)
  // Defaults used when a run does not ask for its own limits (users can set theirs in Settings).
  requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS || 30000),
  maxResponseBytes: Number(env.MAX_RESPONSE_BYTES || 10 * 1024 * 1024),
  // Ceilings for those per-user limits ("0 = no limit" in Settings means "up to this"); 0 here lifts the ceiling.
  maxRequestTimeoutMs: Number(env.MAX_REQUEST_TIMEOUT_MS || 600000),
  maxResponseBytesLimit: Number(env.MAX_RESPONSE_BYTES_LIMIT || 100 * 1024 * 1024),
  udpListenPorts: portRanges(env.UDP_LISTEN_PORTS),
  // Live sessions (WebSocket and the other realtime protocols)
  maxSessionsPerUser: Number(env.MAX_SESSIONS_PER_USER || 10),
  maxSessionsTotal: Number(env.MAX_SESSIONS_TOTAL || 200),
  sessionIdleMs: Number(env.SESSION_IDLE_MS || 15 * 60 * 1000), // closed when nobody is watching or sending
  sessionEventLimit: Number(env.SESSION_EVENT_LIMIT || 5000), // events kept for replay per session
};
/** Changes engine settings in place (everything holding `engine`, or the server's `config`, sees them). */
export const configureEngine = (patch) => Object.assign(engine, patch);
