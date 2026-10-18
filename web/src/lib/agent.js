// Client for the Local Agent on the user's computer (agent/ in the repository): status, pairing, sending a request and
// live sessions. The agent accepts this site only once it is paired: the token it hands out is kept in this browser
// (per agent address) and sent as a bearer token; no cookies are involved.
import { followStream } from "./session.js";

export const DEFAULT_AGENT_URL = "http://127.0.0.1:47823";
const LS = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
/** Loopback http only: the agent never listens anywhere else (and the page's CSP allows nothing else). */
export const validAgentUrl = (u) => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/.test(String(u ?? "").replace(/\/+$/, ""));
export const agentUrl = (fallback = DEFAULT_AGENT_URL) => {
  const u = LS.get("agent.url", "");
  return validAgentUrl(u) ? u.replace(/\/+$/, "") : fallback;
};
export const setAgentUrl = (u) => LS.set("agent.url", u ? String(u).replace(/\/+$/, "") : null);
const tokenKey = (url) => `agent.token:${url}`;
export const agentToken = (url = agentUrl()) => LS.get(tokenKey(url), "") || null;
const setToken = (url, t) => LS.set(tokenKey(url), t);

/** kind: "unreachable" (nothing answers) | "unpaired" (no or unknown token) | "forbidden" (site not allowed) | "busy" | "failed" */
export class AgentError extends Error {
  constructor(kind, message, httpStatus = 0) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus; // not `status`: an agent 401 must never sign the user out of the app
  }
}

async function call(method, path, { body, signal, url = agentUrl(), auth = true } = {}) {
  const token = auth ? agentToken(url) : null;
  let res;
  try {
    res = await fetch(url + path, {
      method,
      headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    // the browser hides why: not running, wrong address, or the agent refused this site (no CORS headers)
    throw new AgentError("unreachable", `The Local Agent is not reachable at ${url} (is it running, and is this site allowed?)`);
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return data;
  const msg = data?.error ?? `The Local Agent answered ${res.status}`;
  const kind = res.status === 401 ? "unpaired" : res.status === 403 ? "forbidden" : res.status === 429 ? "busy" : "failed";
  if (kind === "unpaired" && token) setToken(url, null); // revoked on the agent's side: forget it here too
  throw new AgentError(kind, msg, res.status);
}

export const agent = {
  /** { name, version, paired, ... } */
  health: (url) => call("GET", "/v1/health", { url }),
  async pair(code, url = agentUrl()) {
    const r = await call("POST", "/v1/pair", { url, auth: false, body: { code: String(code).trim(), label: navigator.userAgent.slice(0, 100) } });
    setToken(url, r.token);
    return r;
  },
  async unpair(url = agentUrl()) {
    try { await call("DELETE", "/v1/pair", { url }); } finally { setToken(url, null); }
  },
  /** Sends a request the server built. Resolves { ok, response } or { ok: false, error } (the target failed, not the agent). */
  execute: (request, limits) => call("POST", "/v1/execute", { body: { request, limits } }),
  openSession: (prepared) => call("POST", "/v1/sessions", { body: prepared }),
  act: (id, action, payload) => call("POST", `/v1/sessions/${id}/act`, { body: { action, payload } }),
  close: (id) => call("DELETE", `/v1/sessions/${id}`),
  follow(id, handlers) {
    const url = agentUrl(), token = agentToken(url);
    return followStream((since, signal) => fetch(`${url}/v1/sessions/${id}/events?since=${since}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal, credentials: "omit" }), handlers);
  },
};
