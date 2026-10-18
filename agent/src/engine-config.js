// The bundled agent's stand-in for src/config.js (agent/vite.config.js swaps it in): the shared request engine
// (src/services, src/protocols) reads its limits here. The server's config needs JWT_SECRET and package.json; the agent
// needs neither. agent/src/server.js sets the agent's own values at start.
/* global __AGENT_VERSION__ */
export const version = __AGENT_VERSION__;
export const config = {
  isProd: false,
  allowPrivateTargets: false, // unused: the agent installs its own address policy
  connectAttemptTimeoutMs: Number(process.env.CONNECT_ATTEMPT_TIMEOUT_MS || 5000),
  requestTimeoutMs: 30_000,
  maxResponseBytes: 10 * 1024 * 1024,
  maxRequestTimeoutMs: 600_000,
  maxResponseBytesLimit: 100 * 1024 * 1024,
  udpListenPorts: [],
  maxSessionsPerUser: 20,
  maxSessionsTotal: 80,
  sessionIdleMs: 15 * 60 * 1000,
  sessionEventLimit: 5000,
};
