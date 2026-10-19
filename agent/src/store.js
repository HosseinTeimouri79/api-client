import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_PORT = 47823;
// The agent's own settings. Everything here is local to the user's computer.
export const DEFAULT_CONFIG = {
  port: DEFAULT_PORT,
  host: "127.0.0.1", // loopback only: the agent is never reachable from the network
  origins: [], // the web app origins allowed to use the agent (added by `install --server` and `pair --origin`)
  server: null, // where the agent was installed from (updates come from there)
  // Which addresses requests may go to: public internet, private LAN ranges, this computer, link-local (cloud metadata).
  // `allow` (host names such as "*.corp.local", IPs or CIDRs) limits targets to those; `deny` always wins.
  targets: { public: true, private: true, loopback: true, linkLocal: false, allow: [], deny: [] },
  limits: { maxTimeoutMs: 600_000, maxResponseBytes: 100 * 1024 * 1024, maxConcurrent: 32, maxSessions: 20 },
  udpListenPorts: [[1024, 65535]], // local UDP ports a "listen" request may bind
  autoUpdate: false,
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** "https://app.example.com/anything" -> "https://app.example.com"; null when it is not an http(s) origin. */
export function normalizeOrigin(raw) {
  try {
    const u = new URL(String(raw));
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

/** The agent's files: written atomically and readable by the user only. Tokens and pairing codes are stored hashed. */
export class Store {
  constructor(dir) {
    this.dir = dir;
  }
  file(name) {
    return path.join(this.dir, name);
  }
  read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), "utf8"));
    } catch {
      return fallback;
    }
  }
  write(name, data) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = this.file(`${name}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, this.file(name));
  }

  config() {
    const c = this.read("config.json", {});
    return { ...DEFAULT_CONFIG, ...c, targets: { ...DEFAULT_CONFIG.targets, ...c.targets }, limits: { ...DEFAULT_CONFIG.limits, ...c.limits } };
  }
  updateConfig(patch) {
    const next = { ...this.read("config.json", {}), ...patch };
    this.write("config.json", next);
    return this.config();
  }
  allowOrigin(origin) {
    const o = normalizeOrigin(origin);
    if (!o) throw new Error(`Not a web origin: ${origin}`);
    const c = this.config();
    if (!c.origins.includes(o)) this.updateConfig({ origins: [...c.origins, o] });
    return o;
  }
  removeOrigin(origin) {
    const o = normalizeOrigin(origin) ?? origin;
    this.updateConfig({ origins: this.config().origins.filter((x) => x !== o) });
    this.write("tokens.json", this.tokens().filter((t) => t.origin !== o));
  }

  // ---- pairing: a one-time code made on the computer (CLI) and typed into the web app ----
  /** A new code for `origin`, valid for `ttlMs`; replaces the previous one. */
  startPairing(origin, ttlMs = 10 * 60_000) {
    const o = this.allowOrigin(origin);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
    const code = Array.from(crypto.randomBytes(8), (b) => alphabet[b % 32]).join("");
    this.write("pairing.json", { hash: sha256(code), origin: o, expiresAt: Date.now() + ttlMs, attempts: 0 });
    return { code: `${code.slice(0, 4)}-${code.slice(4)}`, origin: o, expiresAt: Date.now() + ttlMs };
  }
  pairingFor(origin) {
    const p = this.read("pairing.json", null);
    return p && p.origin === origin && p.expiresAt > Date.now() && p.attempts < 5 ? p : null;
  }
  /** Exchanges a code for a token bound to `origin`. Five wrong codes cancel the pairing. */
  completePairing(origin, code, label = "") {
    const p = this.pairingFor(origin);
    if (!p) return { error: "No pairing in progress for this site. Run `api-client-agent pair` on your computer first." };
    const given = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!same(sha256(given), p.hash)) {
      this.write("pairing.json", { ...p, attempts: p.attempts + 1 });
      return { error: p.attempts + 1 >= 5 ? "Too many wrong codes; run `api-client-agent pair` again" : "Wrong pairing code" };
    }
    fs.rmSync(this.file("pairing.json"), { force: true });
    const token = crypto.randomBytes(32).toString("base64url");
    const entry = { id: crypto.randomUUID(), hash: sha256(token), origin, label: String(label).slice(0, 100), createdAt: new Date().toISOString(), lastUsedAt: null };
    this.write("tokens.json", [...this.tokens(), entry]);
    return { token, id: entry.id };
  }

  cancelPairing() {
    fs.rmSync(this.file("pairing.json"), { force: true });
  }

  // ---- the agent's own page (/ui): opened with a one-time link that only someone on this computer can make (the
  // `ui` command, the shortcut), which is swapped for a session cookie. Both are stored hashed, like tokens. ----
  /** A one-time key for /ui/open, valid for `ttlMs`; replaces the previous one. */
  startUiLaunch(ttlMs = 2 * 60_000) {
    const key = crypto.randomBytes(24).toString("base64url");
    this.write("ui-launch.json", { hash: sha256(key), expiresAt: Date.now() + ttlMs });
    return key;
  }
  /** True once for a valid key; the key is used up either way. */
  useUiLaunch(key) {
    const l = this.read("ui-launch.json", null);
    if (!l || !key) return false;
    const ok = l.expiresAt > Date.now() && same(sha256(String(key)), l.hash);
    if (ok) fs.rmSync(this.file("ui-launch.json"), { force: true });
    return ok;
  }
  uiSessions() {
    const s = this.read("ui-sessions.json", []);
    return Array.isArray(s) ? s.filter((x) => x.expiresAt > Date.now()) : [];
  }
  createUiSession(ttlMs = 30 * 24 * 3600_000) {
    const token = crypto.randomBytes(32).toString("base64url");
    this.write("ui-sessions.json", [...this.uiSessions().slice(-9), { hash: sha256(token), expiresAt: Date.now() + ttlMs }]);
    return token;
  }
  hasUiSession(token) {
    if (!token) return false;
    const h = sha256(String(token));
    return this.uiSessions().some((x) => same(x.hash, h));
  }
  endUiSession(token) {
    const h = sha256(String(token ?? ""));
    this.write("ui-sessions.json", this.uiSessions().filter((x) => !same(x.hash, h)));
  }

  // ---- tokens ----
  tokens() {
    const t = this.read("tokens.json", []);
    return Array.isArray(t) ? t : [];
  }
  /** The token entry for a bearer value, or null. */
  findToken(token) {
    if (!token) return null;
    const h = sha256(token);
    return this.tokens().find((t) => same(t.hash, h)) ?? null;
  }
  touchToken(id) {
    const list = this.tokens();
    const t = list.find((x) => x.id === id);
    if (!t || Date.now() - Date.parse(t.lastUsedAt ?? 0) < 60_000) return; // at most one write a minute
    t.lastUsedAt = new Date().toISOString();
    this.write("tokens.json", list);
  }
  /** Removes a token by id (or an id prefix of 6+ characters, as `tokens` lists them). Returns how many went. */
  revokeToken(id) {
    const list = this.tokens();
    const hit = (t) => t.id === id || (String(id).length >= 6 && t.id.startsWith(id));
    this.write("tokens.json", list.filter((t) => !hit(t)));
    return list.length - this.tokens().length;
  }
}
