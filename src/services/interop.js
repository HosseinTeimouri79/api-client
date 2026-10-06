// Import / export converters: Postman (collection v2.0/2.1, environment) and Hoppscotch (collection, environment).
// Everything is converted to / from one neutral tree:
//   folder  = { name, variables[], auth|null, pre_script, post_script, folders[], requests[] }
//   request = same shape as RequestSchema (method, url, params, headers, body, auth, variables, pre_script, post_script)
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const str = (v) => (v == null ? "" : String(v));
const lines = (v) => (Array.isArray(v) ? v.join("\n") : str(v));
const dec = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};
const kvIn = (a, off = "disabled") =>
  (Array.isArray(a) ? a : [])
    .filter((x) => x && x.key != null)
    .map((x) => ({
      key: str(x.key),
      value: str(x.value),
      enabled: off === "active" ? x.active !== false : !x.disabled,
    }));

// {{var}} (native/Postman)  <->  <<var>> (Hoppscotch)
const fromHoppVars = (s) =>
  typeof s === "string" ? s.replace(/<<\s*([^<>\s]+)\s*>>/g, "{{$1}}") : s;
const toHoppVars = (s) =>
  typeof s === "string" ? s.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, "<<$1>>") : s;
// Hoppscotch scripts use pw.*, ours use pm.*: translate the common subset, everything else is kept as-is.
const pwToPm = (s) =>
  str(s)
    .replace(/\bpw\.env\.(get|set|unset)\(/g, "pm.environment.$1(")
    .replace(/\bpw\.(test|expect)\(/g, "pm.$1(");
const pmToPw = (s) =>
  str(s)
    .replace(
      /\bpm\.(?:environment|variables)\.(get|set|unset)\(/g,
      "pw.env.$1(",
    )
    .replace(/\bpm\.(test|expect)\(/g, "pw.$1(");

export function detect(d) {
  const first = Array.isArray(d) ? d[0] : d;
  if (!first || typeof first !== "object") return null;
  if (!Array.isArray(d)) {
    if (first.info && Array.isArray(first.item)) return "postman-collection";
    if (
      Array.isArray(first.values) &&
      (first._postman_variable_scope || first.name)
    )
      return "postman-environment";
  }
  if (Array.isArray(first.folders) || Array.isArray(first.requests))
    return "hoppscotch-collection";
  if (Array.isArray(first.variables) && first.name)
    return "hoppscotch-environment";
  return null;
}

// ---------------------------------------------------------------- Postman -> neutral
const pmGet = (src, k) =>
  (Array.isArray(src) ? src.find((x) => x.key === k)?.value : src?.[k]) ?? "";
function pmAuth(a, warn, ctx) {
  if (!a) return null;
  switch (a.type) {
    case "noauth":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: str(pmGet(a.bearer, "token")) };
    case "basic":
      return {
        type: "basic",
        username: str(pmGet(a.basic, "username")),
        password: str(pmGet(a.basic, "password")),
      };
    case "apikey":
      return {
        type: "apikey",
        key: str(pmGet(a.apikey, "key")),
        value: str(pmGet(a.apikey, "value")),
        in: pmGet(a.apikey, "in") === "query" ? "query" : "header",
      };
    default:
      warn(
        `${ctx}: auth type "${a.type}" is not supported, switched to "inherit"`,
      );
      return null;
  }
}
const pmScript = (events, kind) =>
  lines(events?.find((e) => e.listen === kind && !e.disabled)?.script?.exec);
function pmUrl(u) {
  let raw = typeof u === "string" ? u : str(u?.raw);
  if (!raw && u && typeof u === "object")
    raw = `${u.protocol ? u.protocol + "://" : ""}${lines(u.host).replace(/\n/g, ".")}${u.port ? ":" + u.port : ""}${Array.isArray(u.path) ? "/" + u.path.map((p) => p?.value ?? p).join("/") : ""}`;
  const i = raw.indexOf("?"),
    base = i < 0 ? raw : raw.slice(0, i);
  if (u && typeof u === "object" && Array.isArray(u.query))
    return { url: base, params: kvIn(u.query) };
  const params =
    i < 0
      ? []
      : raw
          .slice(i + 1)
          .split("&")
          .filter(Boolean)
          .map((p) => {
            const [k, ...v] = p.split("=");
            return { key: dec(k), value: dec(v.join("=")), enabled: true };
          });
  return { url: base, params };
}
function pmBody(b, headers, warn, ctx) {
  if (!b) return { mode: "none" };
  const hasCT = headers.some((h) => h.key.toLowerCase() === "content-type");
  switch (b.mode) {
    case "raw": {
      const lang = b.options?.raw?.language,
        content = str(b.raw);
      if (lang === "json") return { mode: "json", content };
      const ct = {
        xml: "application/xml",
        html: "text/html",
        javascript: "application/javascript",
      }[lang];
      if (ct) {
        if (!hasCT)
          headers.push({ key: "Content-Type", value: ct, enabled: true });
        return { mode: "raw", content };
      }
      return { mode: "text", content };
    }
    case "urlencoded":
      return { mode: "urlencoded", fields: kvIn(b.urlencoded) };
    case "formdata": {
      if ((b.formdata ?? []).some((f) => f.type === "file"))
        warn(`${ctx}: file fields in form-data were skipped`);
      return {
        mode: "multipart",
        fields: kvIn((b.formdata ?? []).filter((f) => f.type !== "file")),
      };
    }
    case "graphql": {
      let variables;
      try {
        variables = b.graphql?.variables
          ? JSON.parse(b.graphql.variables)
          : undefined;
      } catch {
        /* keep undefined */
      }
      return {
        mode: "json",
        content: JSON.stringify(
          { query: str(b.graphql?.query), variables },
          null,
          2,
        ),
      };
    }
    default:
      warn(`${ctx}: body type "${b.mode}" is not supported, body skipped`);
      return { mode: "none" };
  }
}
function pmItem(it, warn) {
  if (Array.isArray(it.item)) return { folder: pmFolder(it, warn) };
  const r = it.request;
  if (!r) return null;
  const req = typeof r === "string" ? { method: "GET", url: r } : r,
    ctx = `request "${it.name}"`;
  const method = str(req.method || "GET").toUpperCase();
  if (!METHODS.includes(method))
    warn(`${ctx}: method ${method} is not supported, using GET`);
  const headers = kvIn(req.header),
    { url, params } = pmUrl(req.url);
  return {
    request: {
      name: str(it.name || "Request").slice(0, 200),
      description: lines(req.description?.content ?? req.description).slice(
        0,
        10000,
      ),
      method: METHODS.includes(method) ? method : "GET",
      url,
      params,
      headers,
      body: pmBody(req.body, headers, warn, ctx),
      auth: pmAuth(req.auth, warn, ctx) ?? { type: "inherit" },
      variables: [],
      pre_script: pmScript(it.event, "prerequest"),
      post_script: pmScript(it.event, "test"),
    },
  };
}
function pmFolder(c, warn, name = c.name) {
  const out = {
    name: str(name || "Collection").slice(0, 200),
    variables: kvIn(c.variable).map((v) => ({ ...v, enabled: true })),
    auth: pmAuth(c.auth, warn, `folder "${name}"`),
    pre_script: pmScript(c.event, "prerequest"),
    post_script: pmScript(c.event, "test"),
    folders: [],
    requests: [],
  };
  for (const it of c.item ?? []) {
    const x = pmItem(it, warn);
    if (x?.folder) out.folders.push(x.folder);
    else if (x?.request) out.requests.push(x.request);
  }
  return out;
}

// ---------------------------------------------------------------- Hoppscotch -> neutral
function hoppAuth(a, warn, ctx) {
  if (!a || typeof a !== "object") return null;
  if (a.authActive === false || a.authType === "none") return { type: "none" };
  switch (a.authType) {
    case "inherit":
      return null;
    case "basic":
      return {
        type: "basic",
        username: fromHoppVars(str(a.username)),
        password: fromHoppVars(str(a.password)),
      };
    case "bearer":
      return { type: "bearer", token: fromHoppVars(str(a.token)) };
    case "api-key":
      return {
        type: "apikey",
        key: fromHoppVars(str(a.key)),
        value: fromHoppVars(str(a.value)),
        in: a.addTo === "QUERY_PARAMS" ? "query" : "header",
      };
    default:
      warn(
        `${ctx}: auth type "${a.authType}" is not supported, switched to "inherit"`,
      );
      return null;
  }
}
const hoppKv = (a) =>
  (Array.isArray(a) ? a : [])
    .filter((x) => x?.key != null)
    .map((x) => ({
      key: fromHoppVars(str(x.key)),
      value: fromHoppVars(str(x.value)),
      enabled: x.active !== false,
    }));
function hoppBody(b, warn, ctx) {
  if (!b || !b.contentType) return { mode: "none" };
  const ct = b.contentType.toLowerCase();
  if (ct.includes("json"))
    return { mode: "json", content: fromHoppVars(str(b.body)) };
  if (ct === "application/x-www-form-urlencoded")
    return {
      mode: "urlencoded",
      fields: str(b.body)
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const off = l.startsWith("#"),
            t = off ? l.slice(1) : l,
            i = t.indexOf(":");
          return {
            key: fromHoppVars(t.slice(0, i < 0 ? undefined : i).trim()),
            value: fromHoppVars(i < 0 ? "" : t.slice(i + 1).trim()),
            enabled: !off,
          };
        }),
    };
  if (ct === "multipart/form-data") {
    if (Array.isArray(b.body) && b.body.some((f) => f.isFile))
      warn(`${ctx}: file fields in form-data were skipped`);
    return {
      mode: "multipart",
      fields: hoppKv(
        (Array.isArray(b.body) ? b.body : []).filter((f) => !f.isFile),
      ),
    };
  }
  return {
    mode: ct === "text/plain" ? "text" : "raw",
    content: fromHoppVars(str(b.body)),
    ct: ct === "text/plain" ? undefined : b.contentType,
  };
}
function hoppReq(r, warn) {
  const ctx = `request "${r.name}"`,
    method = str(r.method || "GET").toUpperCase();
  const headers = hoppKv(r.headers),
    body = hoppBody(r.body, warn, ctx);
  if (body.ct) {
    if (!headers.some((h) => h.key.toLowerCase() === "content-type"))
      headers.push({ key: "Content-Type", value: body.ct, enabled: true });
    delete body.ct;
  }
  return {
    name: str(r.name || "Request").slice(0, 200),
    description: "",
    method: METHODS.includes(method) ? method : "GET",
    url: fromHoppVars(str(r.endpoint ?? str(r.url) + str(r.path))),
    params: hoppKv(r.params),
    headers,
    body,
    auth: hoppAuth(r.auth, warn, ctx) ?? { type: "inherit" },
    variables: hoppKv(r.requestVariables).map((v) => ({ ...v, enabled: true })),
    pre_script: pwToPm(r.preRequestScript),
    post_script: pwToPm(r.testScript),
  };
}
function hoppFolder(c, warn) {
  if (Array.isArray(c.headers) && c.headers.length)
    warn(
      `folder "${c.name}": folder-level headers are not supported and were skipped`,
    );
  return {
    name: str(c.name || "Collection").slice(0, 200),
    variables: hoppKv(c.variables).map((v) => ({ ...v, enabled: true })),
    auth: hoppAuth(c.auth, warn, `folder "${c.name}"`),
    pre_script: pwToPm(c.preRequestScript),
    post_script: pwToPm(c.testScript),
    folders: (c.folders ?? []).map((f) => hoppFolder(f, warn)),
    requests: (c.requests ?? []).map((r) => hoppReq(r, warn)),
  };
}

// ---------------------------------------------------------------- environments
const envIn = (name, vars) => ({
  name: str(name || "Imported environment").slice(0, 100),
  variables: vars
    .filter((v) => v?.key)
    .map((v) => ({
      key: str(v.key),
      value: str(v.value ?? v.currentValue ?? v.initialValue),
      enabled: v.enabled !== false,
      ...(v.secret || v.type === "secret" ? { secret: true } : {}),
    })),
});

/** @returns {{ kind: 'collections'|'environments', format: string, collections: object[], environments: object[], warnings: string[] }} */
export function parseImport(data, hint) {
  const format = hint ?? detect(data);
  if (!format)
    throw new Error(
      "Unrecognized file. Supported: Postman collection/environment and Hoppscotch collection/environment (JSON).",
    );
  const warnings = [],
    warn = (m) => {
      if (warnings.length < 50) warnings.push(m);
    },
    list = Array.isArray(data) ? data : [data];
  const out = { format, collections: [], environments: [], warnings };
  if (format === "postman-collection")
    out.collections = list.map((d) => pmFolder(d, warn, d.info?.name));
  else if (format === "hoppscotch-collection") {
    out.collections = list.map((d) => hoppFolder(d, warn));
    if (
      out.collections.some(function hasScript(c) {
        return (
          c.pre_script ||
          c.post_script ||
          c.requests.some((r) => r.pre_script || r.post_script) ||
          c.folders.some(hasScript)
        );
      })
    )
      warn(
        "Hoppscotch scripts (pw.*) were translated where possible; please review them",
      );
  } else if (format === "postman-environment")
    out.environments = list.map((d) => envIn(d.name, d.values ?? []));
  else if (format === "hoppscotch-environment")
    out.environments = list.map((d) =>
      envIn(
        d.name,
        (d.variables ?? []).map((v) => ({ ...v, key: v.key })),
      ),
    );
  else throw new Error(`Unknown format "${format}"`);
  return out;
}

// ---------------------------------------------------------------- neutral -> Postman
const SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";
const kvOut = (a) =>
  (a ?? []).map((x) => ({
    key: x.key,
    value: x.value ?? "",
    ...(x.enabled === false ? { disabled: true } : {}),
  }));
function pmAuthOut(a) {
  if (!a || a.type === "inherit") return undefined;
  const e = (k, v) => ({ key: k, value: v ?? "", type: "string" });
  if (a.type === "none") return { type: "noauth" };
  if (a.type === "bearer")
    return { type: "bearer", bearer: [e("token", a.token)] };
  if (a.type === "basic")
    return {
      type: "basic",
      basic: [e("username", a.username), e("password", a.password)],
    };
  if (a.type === "apikey")
    return {
      type: "apikey",
      apikey: [
        e("key", a.key),
        e("value", a.value),
        e("in", a.in === "query" ? "query" : "header"),
      ],
    };
  return undefined;
}
const pmEvents = (n) =>
  [
    ["prerequest", n.pre_script],
    ["test", n.post_script],
  ]
    .filter(([, s]) => s?.trim())
    .map(([listen, s]) => ({
      listen,
      script: { type: "text/javascript", exec: s.split("\n") },
    }));
function pmUrlOut(url, params) {
  const on = (params ?? []).filter((p) => p.enabled !== false),
    raw =
      url +
      (on.length
        ? "?" + on.map((p) => `${p.key}=${p.value ?? ""}`).join("&")
        : "");
  const m = url.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/]*)(\/.*)?$/i),
    out = { raw };
  if (m) {
    if (m[1]) out.protocol = m[1];
    const pm = m[2].match(/^(.*):(\d+)$/);
    out.host = (pm ? pm[1] : m[2]).split(".");
    if (pm) out.port = pm[2];
    if (m[3]) out.path = m[3].split("/").filter(Boolean);
  }
  if (params?.length) out.query = kvOut(params);
  return out;
}
function pmBodyOut(b) {
  switch (b?.mode) {
    case "json":
      return {
        mode: "raw",
        raw: b.content ?? "",
        options: { raw: { language: "json" } },
      };
    case "text":
    case "raw":
      return {
        mode: "raw",
        raw: b.content ?? "",
        options: { raw: { language: "text" } },
      };
    case "urlencoded":
      return { mode: "urlencoded", urlencoded: kvOut(b.fields) };
    case "multipart":
      return {
        mode: "formdata",
        formdata: kvOut(b.fields).map((f) => ({ ...f, type: "text" })),
      };
    default:
      return undefined;
  }
}
function pmItemsOut(n) {
  const clean = (o) =>
    Object.fromEntries(
      Object.entries(o).filter(
        ([, v]) => v !== undefined && !(Array.isArray(v) && !v.length),
      ),
    );
  return [
    ...n.folders.map((f) =>
      clean({
        name: f.name,
        item: pmItemsOut(f),
        auth: pmAuthOut(f.auth),
        event: pmEvents(f),
      }),
    ),
    ...n.requests.map((r) =>
      clean({
        name: r.name,
        request: clean({
          method: r.method,
          header: kvOut(r.headers),
          url: pmUrlOut(r.url, r.params),
          body: pmBodyOut(r.body),
          auth: pmAuthOut(r.auth),
          description: r.description || undefined,
        }),
        response: [],
        event: pmEvents(r),
      }),
    ),
  ];
}
export const toPostmanCollection = (n, id) => ({
  info: { _postman_id: id, name: n.name, schema: SCHEMA },
  item: pmItemsOut(n),
  ...(pmAuthOut(n.auth) ? { auth: pmAuthOut(n.auth) } : {}),
  ...(pmEvents(n).length ? { event: pmEvents(n) } : {}),
  ...(n.variables?.length
    ? {
        variable: n.variables.map((v) => ({
          key: v.key,
          value: v.value ?? "",
          ...(v.enabled === false ? { disabled: true } : {}),
        })),
      }
    : {}),
});
export const toPostmanEnv = (e, id) => ({
  id,
  name: e.name,
  values: (e.variables ?? []).map((v) => ({
    key: v.key,
    value: v.value ?? "",
    type: v.secret ? "secret" : "default",
    enabled: v.enabled !== false,
  })),
  _postman_variable_scope: "environment",
  _postman_exported_at: new Date().toISOString(),
  _postman_exported_using: "api-client",
});

// ---------------------------------------------------------------- neutral -> Hoppscotch
function hoppAuthOut(a) {
  const base = { authActive: true };
  if (a?.type === "bearer")
    return { authType: "bearer", ...base, token: toHoppVars(a.token ?? "") };
  if (a?.type === "basic")
    return {
      authType: "basic",
      ...base,
      username: toHoppVars(a.username ?? ""),
      password: toHoppVars(a.password ?? ""),
    };
  if (a?.type === "apikey")
    return {
      authType: "api-key",
      ...base,
      key: toHoppVars(a.key ?? ""),
      value: toHoppVars(a.value ?? ""),
      addTo: a.in === "query" ? "QUERY_PARAMS" : "HEADERS",
    };
  return { authType: "none", ...base };
}
const hoppKvOut = (a) =>
  (a ?? []).map((x) => ({
    key: toHoppVars(x.key),
    value: toHoppVars(x.value ?? ""),
    active: x.enabled !== false,
  }));
function hoppBodyOut(b) {
  switch (b?.mode) {
    case "json":
      return {
        contentType: "application/json",
        body: toHoppVars(b.content ?? ""),
      };
    case "text":
    case "raw":
      return { contentType: "text/plain", body: toHoppVars(b.content ?? "") };
    case "urlencoded":
      return {
        contentType: "application/x-www-form-urlencoded",
        body: (b.fields ?? [])
          .map(
            (f) =>
              `${f.enabled === false ? "#" : ""}${toHoppVars(f.key)}: ${toHoppVars(f.value ?? "")}`,
          )
          .join("\n"),
      };
    case "multipart":
      return {
        contentType: "multipart/form-data",
        body: (b.fields ?? []).map((f) => ({
          key: toHoppVars(f.key),
          value: toHoppVars(f.value ?? ""),
          active: f.enabled !== false,
          isFile: false,
        })),
      };
    default:
      return { contentType: null, body: null };
  }
}
export function toHoppCollection(n, inherited = null, warn = () => {}) {
  const auth = n.auth && n.auth.type !== "inherit" ? n.auth : inherited;
  if (n.variables?.length)
    warn(
      `"${n.name}": collection variables have no Hoppscotch equivalent; move them to an environment`,
    );
  if (n.pre_script?.trim() || n.post_script?.trim())
    warn(`"${n.name}": collection-level scripts were not exported`);
  return {
    v: 1,
    name: n.name,
    folders: n.folders.map((f) => toHoppCollection(f, auth, warn)),
    requests: n.requests.map((r) => ({
      v: "1",
      name: r.name,
      method: r.method,
      endpoint: toHoppVars(r.url),
      params: hoppKvOut(r.params),
      headers: hoppKvOut(r.headers),
      preRequestScript: pmToPw(r.pre_script),
      testScript: pmToPw(r.post_script),
      auth: hoppAuthOut(r.auth?.type === "inherit" || !r.auth ? auth : r.auth),
      body: hoppBodyOut(r.body),
    })),
  };
}
export const toHoppEnv = (e, id) => ({
  v: 1,
  id,
  name: e.name,
  variables: (e.variables ?? []).map((v) => ({
    key: v.key,
    value: v.value ?? "",
    secret: !!v.secret,
  })),
});
