import { Router } from "express";
import { z } from "zod";
import { HttpError, requireWorkspace, audit } from "../middleware/auth.js";
import { SessionManager, SessionError } from "../services/sessions.js";
import { sessionContext } from "../services/runner.js";
import { RequestSchema } from "./content.js";
import { IMPLEMENTED } from "../protocols/index.js";
import { connectWebSocket } from "../protocols/websocket.js";

// One connector per live protocol: (context) -> Promise<driver>
const CONNECTORS = { websocket: connectWebSocket };

const toHttp = (e) => (e instanceof SessionError ? new HttpError(e.status, e.message) : e);

/** Live sessions: open a connection, follow its events (SSE), act on it (send, ping, ...) and close it. */
export function sessionsRouter(db, sessions = new SessionManager()) {
  const r = Router({ mergeParams: true });
  const W = (perm) => requireWorkspace(db, perm);
  const wrap = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (e) { next(toHttp(e)); }
  };
  const summary = (s) => ({ id: s.id, protocol: s.protocol, label: s.label, closed: s.closed, createdAt: s.createdAt });
  const own = (req) => sessions.get(req.params.id, req.user.id, req.wid);

  r.get("/sessions", W("request:run"), (req, res) => res.json(sessions.list(req.user.id, req.wid).map(summary)));

  r.post("/sessions", W("request:run"), wrap(async (req, res) => {
    const b = z.object({
      request: RequestSchema.omit({ name: true }).extend({ name: z.string().optional() }),
      collection_id: z.string().nullable().optional(),
      environment_id: z.string().nullable().optional(),
      limits: z.object({ timeoutMs: z.number().int().min(0).max(3_600_000).optional(), maxResponseBytes: z.number().int().min(0).max(4 * 1024 ** 3).optional() }).optional(),
    }).parse(req.body);
    const protocol = b.request.protocol;
    const connect = CONNECTORS[protocol];
    if (!connect || !IMPLEMENTED.includes(protocol)) throw new HttpError(400, `Protocol "${protocol}" has no live connection`);
    if (b.collection_id && !db.prepare("SELECT 1 FROM collections WHERE id=? AND workspace_id=?").get(b.collection_id, req.wid))
      throw new HttpError(404, "Collection not found");
    const ctx = sessionContext(db, { wid: req.wid, request: b.request, collectionId: b.collection_id, environmentId: b.environment_id });
    let s;
    try {
      s = await sessions.create({ userId: req.user.id, wid: req.wid, protocol, label: ctx.request.url }, (c) =>
        connect({ request: ctx.request, inherited: ctx.inherited, data: ctx.request.protocol_data, limits: b.limits, vars: ctx.vars, ctx: c }));
    } catch (e) {
      if (e instanceof SessionError || e instanceof z.ZodError) throw e;
      // connecting failed: a normal outcome the UI shows, not a server error
      return res.status(200).json({ ok: false, error: { phase: "network", message: e.message, status: e.status ?? null, headers: Object.entries(e.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })) } });
    }
    audit(db, req, "session.open", `${protocol} ${s.label}`.slice(0, 200));
    res.status(201).json({ ok: true, ...summary(s) });
  }));

  // Server-Sent Events: `?since=<seq>` (or Last-Event-ID) replays what a reconnecting client missed; `follow=false` ends after the replay.
  r.get("/sessions/:id/events", W("request:run"), wrap(async (req, res) => {
    const s = own(req);
    const since = Number(req.query.since ?? req.headers["last-event-id"] ?? 0) || 0;
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const push = (ev) => {
      if (ev === null) { res.write("event: end\ndata: {}\n\n"); res.end(); return; }
      res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    if (req.query.follow === "false") { // just the backlog, then the stream ends
      sessions.follow(s, since, push)();
      return res.end();
    }
    const off = sessions.follow(s, since, push);
    const beat = setInterval(() => { s.touched = Date.now(); res.write(": keep-alive\n\n"); }, 15_000);
    req.on("close", () => { clearInterval(beat); off(); });
  }));

  r.post("/sessions/:id/act", W("request:run"), wrap(async (req, res) => {
    const b = z.object({ action: z.string().min(1).max(40), payload: z.any().optional() }).parse(req.body);
    res.json(await sessions.act(own(req), b.action, b.payload));
  }));

  r.delete("/sessions/:id", W("request:run"), wrap(async (req, res) => {
    sessions.close(own(req));
    res.json({ ok: true });
  }));

  r.sessions = sessions;
  return r;
}
