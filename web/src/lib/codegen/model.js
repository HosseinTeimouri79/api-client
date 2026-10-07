// Turns an editor request into a neutral, fully resolved model that every language generator consumes.
// It mirrors what the server sends (executor.buildRequest): enabled rows only, auth applied, default Content-Type,
// no body for GET/HEAD. Scripts are not run, and unresolved {{variables}} are left as-is.
const VAR = /\{\{\s*([\w.\-]+)\s*\}\}/g;
const active = (l = []) => l.filter((x) => x.key && x.enabled !== false);

export function resolveVars(str, vars) {
  let cur = String(str ?? "");
  for (let i = 0; i < 5; i++) { // nested references, bounded like the server
    const next = cur.replace(VAR, (m, k) => (k in vars ? vars[k] : m));
    if (next === cur) break;
    cur = next;
  }
  return cur;
}
/** Percent-encodes like the server's URLSearchParams, but leaves unresolved {{vars}} readable. */
export const encodeQuery = (s) =>
  String(s).split(/(\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : new URLSearchParams([["", p]]).toString().slice(1))).join("");
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export function parseUrl(url) {
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/?#]*)([^#]*)/i.exec(url) ?? [];
  const scheme = (m[1] || "http").toLowerCase();
  const authority = (m[2] ?? "").replace(/^[^@]*@/, "");
  const pm = /^(.*?)(?::(\d+))?$/.exec(authority);
  const rest = m[3] ?? "";
  return {
    scheme,
    host: pm?.[1] ?? authority,
    port: pm?.[2] ?? "",
    authority,
    path: rest.startsWith("?") || !rest ? "/" + rest : rest,
  };
}

/**
 * @param req       the editor request ({ method, url, params, headers, body, auth })
 * @param vars      known variables: { name: { value, secret } } (secret values are never substituted)
 * @param inheritedAuth  auth inherited from the collection chain, used when req.auth is "inherit"
 */
export function buildModel(req, { vars = {}, inheritedAuth = null, substitute = true } = {}) {
  const plain = Object.fromEntries(Object.entries(vars).filter(([, v]) => !v.secret).map(([k, v]) => [k, String(v.value ?? "")]));
  const R = (s) => (substitute ? resolveVars(s, plain) : String(s ?? ""));
  const method = (req.method || "GET").toUpperCase();
  let headers = active(req.headers).map((h) => [R(h.key), R(h.value)]);
  const query = active(req.params).map((p) => [R(p.key), R(p.value)]);
  const setHeader = (k, v) => { headers = headers.filter(([n]) => n !== k); headers.push([k, v]); };
  const hasHeader = (n) => headers.some(([k]) => k.toLowerCase() === n);

  const auth = req.auth?.type && req.auth.type !== "inherit" ? req.auth : inheritedAuth;
  if (auth?.type === "bearer") setHeader("Authorization", `Bearer ${R(auth.token)}`);
  else if (auth?.type === "basic") {
    const u = R(auth.username), p = R(auth.password);
    setHeader("Authorization", /\{\{/.test(u + p) ? "Basic <base64(username:password)>" : `Basic ${b64(`${u}:${p}`)}`);
  } else if (auth?.type === "apikey" && auth.key) {
    if (auth.in === "query") query.push([R(auth.key), R(auth.value)]);
    else setHeader(R(auth.key), R(auth.value));
  }

  let url = R(req.url).trim().replace(/#.*$/, "");
  if (query.length) {
    const qs = query.map(([k, v]) => `${encodeQuery(k)}=${encodeQuery(v)}`).join("&");
    url += (url.includes("?") ? (/[?&]$/.test(url) ? "" : "&") : "?") + qs;
  }

  let body = null;
  const b = req.body ?? { mode: "none" };
  if (!["GET", "HEAD"].includes(method)) {
    if (["json", "text", "raw"].includes(b.mode)) {
      const text = R(b.content ?? "");
      if (text) {
        body = { kind: "raw", text };
        if (!hasHeader("content-type")) {
          if (b.mode === "json") headers.push(["Content-Type", "application/json"]);
          else if (b.mode === "text") headers.push(["Content-Type", "text/plain"]);
        }
      }
    } else if (b.mode === "urlencoded") {
      const fields = active(b.fields).map((f) => [R(f.key), R(f.value)]);
      if (fields.length) {
        body = { kind: "urlencoded", fields };
        if (!hasHeader("content-type")) headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
      }
    } else if (b.mode === "multipart") {
      const fields = active(b.fields).map((f) => [R(f.key), R(f.value)]);
      if (fields.length) {
        body = { kind: "multipart", fields };
        headers = headers.filter(([k]) => k.toLowerCase() !== "content-type"); // the boundary comes from the tool
      }
    }
  }
  return { method, url, headers, body, ...parseUrl(url) };
}
