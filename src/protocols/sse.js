import http from "node:http";
import https from "node:https";
import { z } from "zod";
import { safeLookup, assertPublicHost } from "../services/ssrf.js";
import { buildRequest, effectiveLimits } from "../services/executor.js";
import { config } from "../config.js";

export const SseData = z.object({
  reconnect: z.boolean().default(false), // reopen the stream when the server ends it, resuming with Last-Event-ID
  maxReconnects: z.number().int().min(0).max(1000).default(10),
});

/**
 * Incremental parser for text/event-stream (the WHATWG "Server-sent events" format): feed it text chunks, it calls
 * `onEvent({ event, data, id, retry })` per dispatched event and `onComment(text)` for ": ..." lines.
 */
export class SseParser {
  constructor({ onEvent, onComment, maxBytes = Infinity }) {
    Object.assign(this, { onEvent, onComment, maxBytes });
    this.buf = "";
    this.lastId = "";
    this.first = true;
    this.reset();
  }
  reset() { this.data = []; this.event = ""; this.retry = null; this.size = 0; this.hasId = false; this.idValue = ""; }
  push(text) {
    if (this.first) { this.first = false; text = text.replace(/^\uFEFF/, ""); }
    this.buf += text;
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (c === "\n") { this.line(this.buf.slice(start, i)); start = i + 1; }
      else if (c === "\r") {
        if (i === this.buf.length - 1) break; // may be the first half of "\r\n": wait for the next chunk
        this.line(this.buf.slice(start, i));
        if (this.buf[i + 1] === "\n") i++;
        start = i + 1;
      }
    }
    this.buf = this.buf.slice(start);
    if (this.buf.length > this.maxBytes) throw new Error(`An event line is longer than ${this.maxBytes} bytes`);
  }
  /** The stream ended: a pending "\r" still terminates its line. (An unfinished event is dropped, as the standard says.) */
  end() {
    if (this.buf.endsWith("\r")) { const l = this.buf.slice(0, -1); this.buf = ""; this.line(l); }
  }
  line(l) {
    if (l === "") return this.dispatch();
    if (l.startsWith(":")) return this.onComment?.(l.slice(1).replace(/^ /, ""));
    const c = l.indexOf(":");
    const field = c < 0 ? l : l.slice(0, c);
    let value = c < 0 ? "" : l.slice(c + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") { this.data.push(value); this.size += value.length + 1; if (this.size > this.maxBytes) throw new Error(`An event is larger than ${this.maxBytes} bytes`); }
    else if (field === "event") this.event = value;
    else if (field === "id") { if (!value.includes("\0")) { this.hasId = true; this.idValue = value; } }
    else if (field === "retry") { if (/^\d+$/.test(value)) this.retry = Number(value); }
  }
  dispatch() {
    if (this.hasId) this.lastId = this.idValue;
    const retry = this.retry;
    if (this.data.length) this.onEvent({ event: this.event || "message", data: this.data.join("\n"), id: this.lastId, retry });
    else if (retry != null) this.onEvent({ event: null, data: null, id: this.lastId, retry });
    this.reset();
  }
}

const fail = (message, extra = {}) => Object.assign(new Error(message), extra);

/** Opens the HTTP response of an event stream (following redirects with the address check on every hop). */
function openStream(built, { lastEventId, lim, signal }) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    const go = (urlStr) => {
      try { assertPublicHost(urlStr); } catch (e) { return reject(e); }
      const u = new URL(urlStr);
      const req = (u.protocol === "https:" ? https : http).request(u, {
        method: built.method,
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache", "Accept-Encoding": "identity", "User-Agent": "api-client/1.0", ...(lastEventId && { "Last-Event-ID": lastEventId }), ...built.headers },
        lookup: safeLookup, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: config.connectAttemptTimeoutMs, signal,
        timeout: Number.isFinite(lim.timeoutMs) ? lim.timeoutMs : 0,
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops++ < 5) { res.resume(); return go(new URL(res.headers.location, urlStr).toString()); }
        resolve({ res, url: urlStr });
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })));
      req.on("error", reject);
      if (built.body != null) req.write(built.body);
      req.end();
    };
    go(built.url);
  });
}

const reason = (e) => (e.code === "SSRF_BLOCKED" ? e.message : e.code === "ETIMEDOUT" ? "Connection timeout" : e.code === "ECONNREFUSED" ? "Connection refused" : e.code === "ENOTFOUND" ? "DNS lookup failed (host not found)" : (e.errors?.length ? `${e.code ?? "Connection failed"} — ${[...new Set(e.errors.map((x) => x.code ?? x.message))].join("; ")}` : e.message));
const headerList = (res) => Object.entries(res.headers).map(([key, v]) => ({ key, value: Array.isArray(v) ? v.join(", ") : String(v) }));

/** Streams Server-Sent Events. Resolves once the stream is open (HTTP 200, text/event-stream). */
export async function connectSse({ request, inherited, data, limits, ctx }) {
  const cfg = SseData.parse(data ?? {});
  if (!["GET", "POST"].includes(request.method)) throw fail("Event streams are opened with GET or POST", { phase: "validation" });
  let built;
  try { built = await buildRequest({ ...request }, inherited); } catch (e) { throw fail(e.message, { phase: "validation" }); }
  const lim = effectiveLimits(limits);
  const ctl = new AbortController();
  let current = null, closed = false, lastId = "", retryMs = 3000, attempts = 0;

  const open = async () => {
    const { res, url } = await openStream(built, { lastEventId: lastId, lim, signal: ctl.signal });
    const ct = String(res.headers["content-type"] ?? "");
    if (res.statusCode !== 200 || !/text\/event-stream/i.test(ct)) {
      let body = "";
      for await (const c of res) { body += c; if (body.length > 2000) break; }
      res.destroy();
      throw fail(res.statusCode !== 200 ? `The server answered ${res.statusCode} ${res.statusMessage ?? ""}`.trim() : `The server did not answer with text/event-stream (got ${ct || "no content type"})`, { status: res.statusCode, headers: res.headers, body: body.slice(0, 2000) });
    }
    return { res, url };
  };

  const pump = (res, url, again) => {
    current = res;
    ctx.emit("open", { url, status: res.statusCode, headers: headerList(res), ...(again && { reconnected: true }) });
    res.setEncoding("utf8");
    const parser = new SseParser({
      maxBytes: lim.maxBytes,
      onComment: (text) => ctx.emit("comment", { text }),
      onEvent: (e) => {
        if (e.id) lastId = e.id;
        if (e.retry != null) { retryMs = e.retry; ctx.emit("retry", { text: `${e.retry} ms` }); }
        if (e.data == null) return;
        ctx.emit("message", { direction: "in", binary: false, size: Buffer.byteLength(e.data), data: e.data, event: e.event, id: e.id });
      },
    });
    res.on("data", (chunk) => {
      try { parser.push(chunk); } catch (err) { ctx.emit("error", { message: err.message }); res.destroy(); stop(`stopped: ${err.message}`); }
    });
    res.on("end", () => { try { parser.end(); } catch { /* too large */ } ended("the server ended the stream"); });
    res.on("error", (e) => { if (!closed) ended(reason(e)); });
  };

  const stop = (why) => { if (closed) return; closed = true; ctl.abort(); ctx.finish({ reason: why }); };
  const ended = async (why) => {
    if (closed) return;
    if (!cfg.reconnect || attempts >= cfg.maxReconnects) return stop(attempts >= cfg.maxReconnects && cfg.reconnect ? "gave up reconnecting" : why);
    attempts++;
    ctx.emit("reconnecting", { text: `#${attempts} in ${retryMs} ms${lastId ? `, Last-Event-ID: ${lastId}` : ""}` });
    await new Promise((r) => setTimeout(r, retryMs));
    if (closed) return;
    try { const { res, url } = await open(); pump(res, url, true); } catch (e) { if (closed) return; ctx.emit("error", { message: e.message ? reason(e) : String(e) }); ended(reason(e)); }
  };

  let first;
  try { first = await open(); } catch (e) { throw e.status ? e : fail(reason(e), { code: e.code }); }
  pump(first.res, first.url, false);
  return {
    async act(action) {
      if (action !== "close") throw new Error(`Unknown action "${action}"`);
      stop("closed by you");
      return { ok: true };
    },
    close() { stop("closed"); },
  };
}
