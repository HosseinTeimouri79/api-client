import crypto from "node:crypto";

/**
 * Runs that wait for their network result (Local mode): phase one ran on the server, the browser sends the built request
 * to the Local Agent and reports the outcome back. A run belongs to the user and workspace that started it, is completed
 * once, and is forgotten when nobody completes it in time.
 */
export class PendingRuns {
  constructor({ perUser = 20, total = 2000 } = {}) {
    Object.assign(this, { perUser, total });
    this.runs = new Map();
    this.timer = setInterval(() => this.sweep(), 15_000);
    this.timer.unref();
  }

  add({ userId, wid, ttlMs, ...data }) {
    this.sweep();
    const mine = [...this.runs.values()].filter((r) => r.userId === userId).length;
    if (mine >= this.perUser || this.runs.size >= this.total) return null;
    const id = crypto.randomUUID();
    this.runs.set(id, { id, userId, wid, expiresAt: Date.now() + ttlMs, ...data });
    return id;
  }

  /** Removes and returns the run if `userId` started it in `wid`; null for missing, expired or someone else's. */
  take(id, userId, wid) {
    const r = this.runs.get(id);
    if (!r || r.userId !== userId || r.wid !== wid || r.expiresAt < Date.now()) return null;
    this.runs.delete(id);
    return r;
  }

  sweep() {
    const now = Date.now();
    for (const [id, r] of this.runs) if (r.expiresAt < now) this.runs.delete(id);
  }

  stop() {
    clearInterval(this.timer);
    this.runs.clear();
  }
}
