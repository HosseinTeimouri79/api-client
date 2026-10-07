import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Live sessions: one open connection (WebSocket, ...) owned by a user, with an event log that clients follow
 * over Server-Sent Events. Events are numbered, so a client that reconnects asks for what it missed (`since`).
 * A driver (one per protocol) gets `{ emit, finish }` and returns `{ act(action, payload), close() }`.
 */
export class SessionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class SessionManager {
  constructor({ idleMs = config.sessionIdleMs, perUser = config.maxSessionsPerUser, total = config.maxSessionsTotal, keep = config.sessionEventLimit } = {}) {
    Object.assign(this, { idleMs, perUser, total, keep });
    this.sessions = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(30_000, Math.max(50, idleMs / 2)));
    this.timer.unref();
  }

  /** Starts a session. `open(ctx)` connects and returns the driver (it may throw: nothing is registered then). */
  async create({ userId, wid, protocol, label }, open) {
    const mine = [...this.sessions.values()].filter((s) => s.userId === userId && !s.closed).length;
    if (mine >= this.perUser) throw new SessionError(429, `Too many open connections (max ${this.perUser}); close one first`);
    if (this.sessions.size >= this.total) throw new SessionError(503, "The server has too many open connections right now");
    const s = {
      id: crypto.randomUUID(), userId, wid, protocol, label,
      events: [], seq: 0, base: 0, listeners: new Set(), driver: null,
      closed: false, createdAt: Date.now(), touched: Date.now(), deleteAt: 0,
    };
    const ctx = {
      emit: (type, data = {}) => this.emit(s, type, data),
      finish: (data) => this.finish(s, data),
    };
    this.sessions.set(s.id, s);
    try {
      s.driver = await open(ctx);
    } catch (e) {
      this.sessions.delete(s.id);
      throw e;
    }
    if (s.closed) s.driver?.close?.(); // the driver finished while still opening
    return s;
  }

  emit(s, type, data) {
    const ev = { seq: ++s.seq, ts: new Date().toISOString(), type, ...data };
    s.events.push(ev);
    if (s.events.length > this.keep) {
      const cut = s.events.length - this.keep;
      s.events.splice(0, cut);
      s.base += cut;
    }
    for (const l of s.listeners) l(ev);
    return ev;
  }

  /** The connection ended (by either side). The log stays readable for a minute. */
  finish(s, data = {}) {
    if (s.closed) return;
    s.closed = true;
    this.emit(s, "closed", data);
    s.deleteAt = Date.now() + 60_000;
    for (const l of [...s.listeners]) l(null);
  }

  /** The session if `userId` owns it in `wid`; same error for "missing" and "someone else's". */
  get(id, userId, wid) {
    const s = this.sessions.get(id);
    if (!s || s.userId !== userId || s.wid !== wid) throw new SessionError(404, "Session not found");
    s.touched = Date.now();
    return s;
  }

  list(userId, wid) {
    return [...this.sessions.values()].filter((s) => s.userId === userId && s.wid === wid);
  }

  async act(s, action, payload) {
    if (s.closed) throw new SessionError(409, "The connection is closed");
    s.touched = Date.now();
    try {
      return await s.driver.act(action, payload);
    } catch (e) {
      if (e instanceof SessionError) throw e;
      throw new SessionError(400, e.message);
    }
  }

  close(s) {
    if (!s.closed) {
      try { s.driver?.close?.(); } catch { /* already gone */ }
      this.finish(s, { reason: "closed by you" });
    }
  }

  /** Follows a session: replays events after `since`, then live ones. `push(null)` means it ended. Returns an unsubscribe. */
  follow(s, since, push) {
    const first = Math.max(0, since - s.base);
    for (const ev of s.events.slice(first)) push(ev);
    if (s.closed) {
      push(null);
      return () => {};
    }
    s.listeners.add(push);
    return () => s.listeners.delete(push);
  }

  sweep() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.closed) {
        if (now > s.deleteAt) this.sessions.delete(s.id);
      } else if (now - s.touched > this.idleMs) {
        try { s.driver?.close?.(); } catch { /* ignore */ }
        this.finish(s, { reason: "closed after being idle" });
      }
    }
  }

  closeAll() {
    for (const s of this.sessions.values()) this.close(s);
  }
  stop() {
    clearInterval(this.timer);
    this.closeAll();
  }
}
