import express from "express";
import { z, ZodError } from "zod";
import { execute, fromWire } from "../../src/services/executor.js";
import { SessionManager, SessionError } from "../../src/services/sessions.js";
import { CONNECTORS, connectFailure } from "../../src/protocols/connectors.js";
import { setAddressPolicy } from "../../src/services/ssrf.js";
import { config as engine } from "../../src/config.js";
import { HTTP_METHODS } from "../../src/protocols/index.js";
import { makeAddressPolicy } from "./policy.js";

/**
 * The Local Agent's API, for the web app open in the user's browser (and nothing else):
 *
 * - it listens on loopback only and answers only when the Host header is the loopback address it listens on, so a
 *   DNS-rebinding page (evil.example resolving to 127.0.0.1) is refused;
 * - a browser request must come from an origin the user allowed (`pair --origin`, `install --server`); CORS headers,
 *   including Private Network Access, are sent to those origins only;
 * - every call except /v1/health and /v1/pair needs a bearer token, which pairing hands out once per site; a token works
 *   only from the origin it was paired for. No cookies are used, so there is no ambient authority to forge (CSRF), and
 *   POST bodies must be application/json, which a cross-site form cannot send;
 * - requests go out through the same engine as the server's (src/services/executor.js, src/protocols), with the agent's
 *   own address policy (agent/src/policy.js) in place of the server's SSRF rule.
 */
export function createAgentApp({ store, version, log, port: getPort }) {
  const cfg = store.config();
  // the shared engine reads its limits from the server's config object; the agent sets its own
  Object.assign(engine, {
    requestTimeoutMs: Math.min(30_000, cfg.limits.maxTimeoutMs || 30_000),
    maxRequestTimeoutMs: cfg.limits.maxTimeoutMs,
    maxResponseBytes: Math.min(10 * 1024 * 1024, cfg.limits.maxResponseBytes || 10 * 1024 * 1024),
    maxResponseBytesLimit: cfg.limits.maxResponseBytes,
    udpListenPorts: cfg.udpListenPorts,
  });
  setAddressPolicy(makeAddressPolicy(cfg.targets));
  const sessions = new SessionManager({ perUser: cfg.limits.maxSessions, total: cfg.limits.maxSessions * 4 });
  let inFlight = 0;

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  const fail = (res, status, error) => res.status(status).json({ error });

  // 1. Host: only the loopback name we listen on (anti DNS rebinding)
  app.use((req, res, next) => {
    const p = getPort();
    const ok = [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`].includes(String(req.headers.host ?? "").toLowerCase());
    if (!ok) return fail(res, 421, "Invalid Host header");
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    next();
  });
  // 2. Origin + CORS: allowed sites only; requests without an Origin come from programs on this computer (CLI, scripts)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    req.siteOrigin = origin ?? null;
    if (origin === undefined) return next();
    if (!store.config().origins.includes(origin)) {
      log.warn("refused a request from a site that is not allowed", { origin });
      return fail(res, 403, "This site is not allowed to use the Local Agent");
    }
    res.set({ "Access-Control-Allow-Origin": origin, Vary: "Origin" });
    if (req.method === "OPTIONS") {
      res.set({
        "Access-Control-Allow-Methods": "GET, POST, DELETE",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Last-Event-ID",
        "Access-Control-Max-Age": "600",
      });
      if (req.headers["access-control-request-private-network"] === "true") res.set("Access-Control-Allow-Private-Network", "true");
      return res.status(204).end();
    }
    next();
  });
  // 3. JSON bodies only (forces a CORS preflight; no form can send this)
  app.use((req, res, next) => (req.method === "POST" && !req.is("application/json") ? fail(res, 415, "Send application/json") : next()));
  app.use(express.json({ limit: "16mb" }));

  const tokenOf = (req) => {
    const h = req.headers.authorization;
    return h?.startsWith("Bearer ") ? store.findToken(h.slice(7)) : null;
  };
  const auth = (req, res, next) => {
    const t = tokenOf(req);
    if (!t) return fail(res, 401, "Pair this site with the Local Agent first");
    if (req.siteOrigin && t.origin !== req.siteOrigin) return fail(res, 403, "This token was paired for another site");
    req.client = t;
    store.touchToken(t.id);
    next();
  };
  const wrap = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (e) { next(e); }
  };

  // ---- status and pairing ----
  app.get("/v1/health", (req, res) => {
    const t = tokenOf(req);
    const paired = !!t && (!req.siteOrigin || t.origin === req.siteOrigin);
    const base = { name: "api-client-agent", version, paired };
    if (!paired) return res.json(base);
    const c = store.config();
    res.json({ ...base, platform: process.platform, node: process.versions.node, targets: c.targets, limits: c.limits, server: c.server, sessions: sessions.list(t.id, "local").filter((s) => !s.closed).length });
  });

  app.post("/v1/pair", (req, res) => {
    if (!req.siteOrigin) return fail(res, 400, "Pairing is done from the web app");
    const b = z.object({ code: z.string().min(4).max(20), label: z.string().max(100).optional() }).parse(req.body);
    const r = store.completePairing(req.siteOrigin, b.code, b.label ?? req.headers["user-agent"] ?? "");
    if (r.error) {
      log.warn("pairing refused", { origin: req.siteOrigin, reason: r.error });
      return fail(res, 403, r.error);
    }
    log.info("paired", { origin: req.siteOrigin, token: r.id.slice(0, 8) });
    res.json({ token: r.token, version });
  });
  app.delete("/v1/pair", auth, (req, res) => {
    store.revokeToken(req.client.id);
    for (const s of sessions.list(req.client.id, "local")) sessions.close(s);
    log.info("unpaired", { origin: req.client.origin, token: req.client.id.slice(0, 8) });
    res.json({ ok: true });
  });

  // ---- one request (HTTP, GraphQL query/mutation): the server built it, the agent sends it ----
  const Wire = z.object({
    url: z.string().min(1).max(20_000),
    method: z.enum(HTTP_METHODS),
    headers: z.record(z.string().max(10_000), z.string().max(1_000_000)).default({}),
    body: z.string().nullable().optional(),
    bodyEncoding: z.enum(["utf8", "base64"]).default("utf8"),
    connectTarget: z.string().max(300).optional(),
  });
  const Limits = z.object({ timeoutMs: z.number().int().min(0).optional(), maxResponseBytes: z.number().int().min(0).optional() }).optional();
  const describe = (e) => ({
    code: typeof e.code === "string" ? e.code : undefined,
    message: String(e.message || e.code || "Request failed"),
    ...(Array.isArray(e.errors) && { errors: e.errors.slice(0, 20).map((x) => ({ code: x.code, message: x.message, address: x.address, port: x.port })) }),
  });
  const selfTarget = (u) => ["127.0.0.1", "localhost", "[::1]", "0.0.0.0"].includes(u.hostname) && Number(u.port || (u.protocol === "https:" ? 443 : 80)) === getPort();

  app.post("/v1/execute", auth, wrap(async (req, res) => {
    const b = z.object({ request: Wire, limits: Limits }).parse(req.body);
    const u = new URL(b.request.url);
    if (!["http:", "https:"].includes(u.protocol)) return fail(res, 400, "Only http and https are supported");
    if (selfTarget(u)) return res.json({ ok: false, error: { code: "AGENT_ERROR", message: "The Local Agent does not send requests to itself" } });
    if (inFlight >= store.config().limits.maxConcurrent) return fail(res, 429, "The Local Agent is busy; try again in a moment");
    inFlight++;
    try {
      const response = await execute(fromWire(b.request), { limits: b.limits });
      log.info("request", { method: b.request.method, target: u.origin, status: response.status, ms: response.durationMs, site: req.client.origin });
      res.json({ ok: true, response });
    } catch (e) {
      log.info("request failed", { method: b.request.method, target: u.origin, code: e.code ?? null, site: req.client.origin });
      res.json({ ok: false, error: describe(e) });
    } finally {
      inFlight--;
    }
  }));

  // ---- live sessions: same drivers and event log as the server's (src/services/sessions.js) ----
  const kv = z.array(z.object({ key: z.string(), value: z.string().default(""), enabled: z.boolean().optional() }).passthrough()).max(500).default([]);
  const AuthSchema = z.object({ type: z.string() }).passthrough().nullable().default(null);
  const Open = z.object({
    protocol: z.enum(Object.keys(CONNECTORS)),
    request: z.object({ url: z.string().max(8000).default(""), protocol_data: z.record(z.string(), z.unknown()).default({}), params: kv, headers: kv, auth: AuthSchema }).passthrough(),
    inherited: AuthSchema,
    vars: z.record(z.string(), z.string()).default({}),
    limits: Limits,
  });
  const summary = (s) => ({ id: s.id, protocol: s.protocol, label: s.label, closed: s.closed, createdAt: s.createdAt });
  const own = (req) => sessions.get(req.params.id, req.client.id, "local");

  app.get("/v1/sessions", auth, (req, res) => res.json(sessions.list(req.client.id, "local").map(summary)));
  app.post("/v1/sessions", auth, wrap(async (req, res) => {
    const b = Open.parse(req.body);
    let s;
    try {
      s = await sessions.create({ userId: req.client.id, wid: "local", protocol: b.protocol, label: b.request.url }, (c) =>
        CONNECTORS[b.protocol]({ request: b.request, inherited: b.inherited, data: b.request.protocol_data, limits: b.limits, vars: b.vars, ctx: c }));
    } catch (e) {
      if (e instanceof SessionError || e instanceof ZodError) throw e;
      return res.json({ ok: false, error: connectFailure(e) });
    }
    log.info("connection opened", { protocol: b.protocol, site: req.client.origin });
    res.status(201).json({ ok: true, ...summary(s) });
  }));
  app.get("/v1/sessions/:id/events", auth, (req, res) => {
    const s = own(req);
    const since = Number(req.query.since ?? req.headers["last-event-id"] ?? 0) || 0;
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders();
    const push = (ev) => {
      if (ev === null) { res.write("event: end\ndata: {}\n\n"); res.end(); return; }
      res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    const off = sessions.follow(s, since, push);
    const beat = setInterval(() => { s.touched = Date.now(); res.write(": keep-alive\n\n"); }, 15_000);
    req.on("close", () => { clearInterval(beat); off(); });
  });
  app.post("/v1/sessions/:id/act", auth, wrap(async (req, res) => {
    const b = z.object({ action: z.string().min(1).max(40), payload: z.any().optional() }).parse(req.body);
    res.json(await sessions.act(own(req), b.action, b.payload));
  }));
  app.delete("/v1/sessions/:id", auth, (req, res) => {
    sessions.close(own(req));
    res.json({ ok: true });
  });
  // connections of a token that was revoked (`api-client-agent tokens revoke`, unpair) are closed
  const reaper = setInterval(() => {
    const ids = new Set(store.tokens().map((t) => t.id));
    for (const s of sessions.sessions.values()) if (!s.closed && !ids.has(s.userId)) sessions.close(s);
  }, 10_000);
  reaper.unref();

  app.use((_req, res) => fail(res, 404, "Not found"));
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: "Validation failed", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    if (err instanceof SessionError) return fail(res, err.status, err.message);
    if (err?.type === "entity.too.large") return fail(res, 413, "Payload too large");
    if (err?.type === "entity.parse.failed") return fail(res, 400, "Malformed JSON");
    if (err instanceof TypeError && /Invalid URL/.test(err.message)) return fail(res, 400, "Invalid URL");
    log.error("internal error", { message: err?.message });
    fail(res, 500, "Internal error");
  });
  app.stop = () => { clearInterval(reaper); sessions.stop(); };
  return app;
}

/** Starts the agent on loopback. Resolves with the server once it listens. */
export async function startAgent({ store, version, log, port }) {
  const cfg = store.config();
  if (!["127.0.0.1", "::1", "localhost"].includes(cfg.host)) throw new Error(`The agent listens on loopback only (host "${cfg.host}" is not allowed)`);
  let bound = 0;
  const app = createAgentApp({ store, version, log, port: () => bound });
  const server = await new Promise((ok, no) => {
    const s = app.listen(port ?? cfg.port, cfg.host === "localhost" ? "127.0.0.1" : cfg.host);
    s.once("listening", () => ok(s));
    s.once("error", no);
  });
  bound = server.address().port;
  server.on("close", () => app.stop());
  return server;
}
