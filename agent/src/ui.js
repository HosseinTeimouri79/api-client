import express from "express";
import { z } from "zod";
import { normalizeOrigin } from "./store.js";
import { uiAssets } from "./ui-assets.js";
import { validTarget } from "./policy.js";

/**
 * The agent's own page, http://127.0.0.1:<port>/ui/, for the person at this computer: status, the sites allowed to use
 * the agent and their pairing, which networks requests may reach, recent activity, settings and updates.
 *
 * Who may use it:
 * - it is opened with a one-time link that only someone who can run the agent as this user can make (the `ui` command,
 *   the Start menu / applications shortcut, setup); the link's key is swapped for a session cookie (HttpOnly,
 *   SameSite=Strict, Path=/ui), so the key in the address bar is worthless afterwards;
 * - its API answers only to the page itself: a request from any other origin (including the sites allowed to use the
 *   agent) is refused, and every change needs the page's own Origin, so another site cannot make the browser change the
 *   agent's settings (CSRF), and sites can never widen their own access;
 * - the Host check (DNS rebinding) in server.js comes first; nothing here sends CORS headers;
 * - a strict Content-Security-Policy: the page's own scripts only, no frames, no other connections.
 */
export const UI_COOKIE = "agent_ui";
const SESSION_DAYS = 30;
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:", "img-src 'self' data:",
  "connect-src 'self'", "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

/** The last events (requests sent, connections opened, pairing, refusals), for the page's Activity list. */
export function createActivity(max = 200) {
  let seq = 0;
  const items = [];
  return {
    add(e) {
      items.push({ seq: ++seq, at: new Date().toISOString(), ...e });
      if (items.length > max) items.shift();
    },
    since: (n = 0) => items.filter((x) => x.seq > n),
  };
}

const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};
const siteAddress = (raw) => normalizeOrigin(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(raw).trim()) ? String(raw).trim() : `https://${String(raw).trim()}`);

const Targets = z.object({
  public: z.boolean(), private: z.boolean(), loopback: z.boolean(), linkLocal: z.boolean(),
  allow: z.array(z.string().trim().max(253)).max(200).transform((a) => a.filter(Boolean)),
  deny: z.array(z.string().trim().max(253)).max(200).transform((a) => a.filter(Boolean)),
}).strict();
const Settings = z.object({
  port: z.number().int().min(1024).max(65535),
  autoUpdate: z.boolean(),
  limits: z.object({
    maxTimeoutMs: z.number().int().min(1000).max(3_600_000),
    maxResponseBytes: z.number().int().min(1024 * 1024).max(1024 * 1024 * 1024),
    maxConcurrent: z.number().int().min(1).max(256),
    maxSessions: z.number().int().min(1).max(200),
  }).strict(),
}).partial().strict();

/**
 * @param control what only the running program can do (main.js): { managed, packaged, paths, checkUpdate, update,
 *   restart, stop }. `managed`: started by the background service, which starts it again after restart().
 */
export function uiRouter({ store, version, log, port, activity, engine, control = {} }) {
  const r = express.Router();
  const startedAt = new Date().toISOString();
  const fail = (res, status, error) => res.status(status).json({ error });
  const selfOrigins = () => [`http://127.0.0.1:${port()}`, `http://localhost:${port()}`, `http://[::1]:${port()}`];

  r.use((req, res, next) => {
    res.set({ "Content-Security-Policy": CSP, "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin" });
    const origin = req.headers.origin;
    const crossSite = ["cross-site", "same-site"].includes(String(req.headers["sec-fetch-site"] ?? ""));
    if ((origin !== undefined && !selfOrigins().includes(origin)) || (crossSite && req.path !== "/")) {
      log.warn("refused a request to the agent's page from another site", { origin: origin ?? null });
      activity.add({ kind: "refused", site: origin ?? null, reason: "page" });
      return fail(res, 403, "Only the agent's own page can do this");
    }
    if (!["GET", "HEAD"].includes(req.method) && origin === undefined) return fail(res, 403, "Only the agent's own page can do this");
    next();
  });

  // ---- opening: one-time key -> session cookie ----
  r.get("/open", (req, res) => {
    if (store.useUiLaunch(req.query.key)) {
      const token = store.createUiSession(SESSION_DAYS * 24 * 3600_000);
      res.append("Set-Cookie", `${UI_COOKIE}=${token}; Path=/ui; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 24 * 3600}`);
      log.info("the agent's page was opened");
      return res.redirect(303, "/ui/");
    }
    log.warn("an expired or used link to the agent's page was opened");
    res.redirect(303, "/ui/#expired");
  });

  // ---- the page itself (no secrets in it: everything comes from the API below) ----
  r.get(/^\/(?!api\/)(.*)$/, (req, res, next) => {
    const files = uiAssets();
    if (!files) return res.status(503).type("text/plain").send("The agent's page was not built (npm run build).");
    const f = files.get(req.params[0] || "index.html");
    if (!f) return next();
    res.type(f.type).send(f.body);
  });

  // ---- API ----
  const api = express.Router();
  r.use("/api", api);
  api.use((req, res, next) => (req.method === "POST" && !req.is("application/json") ? fail(res, 415, "Send application/json") : next()));
  api.use(express.json({ limit: "64kb" }));
  api.use((req, res, next) => {
    req.uiSession = cookieOf(req, UI_COOKIE);
    return store.hasUiSession(req.uiSession) ? next() : fail(res, 401, "locked");
  });
  const state = () => {
    const c = store.config();
    const p = store.read("pairing.json", null);
    return {
      version, platform: process.platform, arch: process.arch, node: process.versions.node, pid: process.pid, startedAt, port: port(),
      managed: !!control.managed, packaged: !!control.packaged, canUpdate: !!control.update && !control.packaged, paths: control.paths ?? null,
      config: { origins: c.origins, server: c.server, port: c.port, autoUpdate: c.autoUpdate, targets: c.targets, limits: c.limits },
      tokens: store.tokens().map(({ id, origin, label, createdAt, lastUsedAt }) => ({ id, origin, label, createdAt, lastUsedAt })),
      pairing: p && p.expiresAt > Date.now() && p.attempts < 5 ? { origin: p.origin, expiresAt: p.expiresAt } : null,
      sessions: engine.openSessions(), inFlight: engine.inFlight(),
    };
  };
  api.get("/state", (_req, res) => res.json(state()));
  api.get("/activity", (req, res) => res.json(activity.since(Number(req.query.since) || 0)));

  api.post("/sites", (req, res) => {
    const { address } = z.object({ address: z.string().min(1).max(2000) }).parse(req.body);
    const origin = siteAddress(address);
    if (!origin) return fail(res, 400, "not-an-address");
    if (selfOrigins().includes(origin)) return fail(res, 400, "self");
    store.allowOrigin(origin);
    if (!store.config().server) store.updateConfig({ server: origin }); // the first site is where updates come from
    log.info("site allowed from the agent's page", { origin });
    res.json({ origin, state: state() });
  });
  api.post("/sites/remove", (req, res) => {
    const { origin } = z.object({ origin: z.string().max(2000) }).parse(req.body);
    store.removeOrigin(origin);
    const c = store.config();
    if (c.server === origin) store.updateConfig({ server: c.origins[0] ?? null });
    if (store.read("pairing.json", null)?.origin === origin) store.cancelPairing();
    log.info("site removed from the agent's page", { origin });
    res.json(state());
  });
  api.post("/pair", (req, res) => {
    const { origin } = z.object({ origin: z.string().max(2000) }).parse(req.body);
    if (!store.config().origins.includes(origin)) return fail(res, 400, "unknown-site");
    const p = store.startPairing(origin);
    log.info("pairing code made on the agent's page", { origin });
    res.json(p);
  });
  api.post("/pair/cancel", (_req, res) => { store.cancelPairing(); res.json(state()); });
  api.post("/tokens/revoke", (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    store.revokeToken(id);
    log.info("token revoked from the agent's page", { token: id.slice(0, 8) });
    res.json(state());
  });

  api.post("/targets", (req, res) => {
    const t = Targets.parse(req.body);
    const bad = [...t.allow, ...t.deny].filter((e) => !validTarget(e));
    if (bad.length) return res.status(400).json({ error: "bad-targets", entries: bad });
    store.updateConfig({ targets: t });
    engine.applyTargets(store.config().targets); // at once: no restart needed
    log.info("target rules changed from the agent's page", { ...t, allow: t.allow.length, deny: t.deny.length });
    res.json(state());
  });
  api.post("/settings", (req, res) => {
    const s = Settings.parse(req.body);
    const before = store.config();
    store.updateConfig({ ...s, ...(s.limits && { limits: { ...store.read("config.json", {}).limits, ...s.limits } }) });
    const after = store.config();
    const restart = after.port !== port() || JSON.stringify(after.limits) !== JSON.stringify(before.limits) || after.autoUpdate !== before.autoUpdate;
    log.info("settings changed from the agent's page", s);
    res.json({ restart, state: state() });
  });

  // the update source's answer (or why there is none) is shown on the page as it is
  const upstream = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { fail(res, 502, String(e.message || e)); }
  };
  api.post("/update/check", upstream(async (_req, res) => {
    if (!control.checkUpdate) return fail(res, 400, "no-update");
    res.json(await control.checkUpdate());
  }));
  api.post("/update", upstream(async (_req, res) => {
    if (!control.update || control.packaged) return fail(res, 400, "no-update");
    if (!store.config().server) return fail(res, 400, "No API Client site to update from: add one first");
    const r = await control.update();
    log.info(r.updated ? `updated to ${r.version} from the agent's page` : "update: already up to date");
    res.json({ ...r, restarting: r.updated && !!control.managed });
    if (r.updated && control.managed) setTimeout(() => control.restart(), 300);
  }));
  api.post("/restart", (_req, res) => {
    if (!control.managed) return fail(res, 400, "not-managed");
    res.json({ ok: true });
    setTimeout(() => control.restart(), 300);
  });
  api.post("/stop", (_req, res) => {
    if (!control.stop) return fail(res, 400, "no-stop");
    res.json({ ok: true });
    setTimeout(() => control.stop(), 300);
  });
  api.post("/logout", (req, res) => {
    store.endUiSession(req.uiSession);
    res.append("Set-Cookie", `${UI_COOKIE}=; Path=/ui; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });
  return r;
}
