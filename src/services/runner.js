import { parse, j } from "../db/index.js";
import { mergeScopes, resolve, resolveDeep, toMap } from "./variables.js";
import { buildRequest, execute } from "./executor.js";
import { runScript } from "./scriptEngine.js";

import { HTTP_METHODS as METHODS, BODYLESS_METHODS } from "../protocols/index.js";
const BODY_MODES = ["none", "json", "text", "urlencoded", "multipart", "raw"];
const kv = (obj) =>
  Object.entries(obj).map(([key, value]) => ({ key, value, enabled: true }));
const fromObj = (o) => kv(o);

export function collectionChain(db, collectionId) {
  const chain = [];
  let id = collectionId,
    guard = 0;
  while (id && guard++ < 50) {
    const c = db.prepare("SELECT * FROM collections WHERE id=?").get(id);
    if (!c) break;
    chain.unshift({
      ...c,
      variables: parse(c.variables, []),
      auth: parse(c.auth, null),
    });
    id = c.parent_id;
  }
  return chain; // root -> leaf
}

const cleanList = (l) =>
  (Array.isArray(l) ? l : []).map((x) => ({
    key: String(x?.key ?? ""),
    value: String(x?.value ?? ""),
    enabled: x?.enabled !== false,
  }));
// A pre-request script hands back its view of the request; accept only well-formed pieces.
function applyRequestPatch(cur, p) {
  if (!p) return cur;
  if (!METHODS.includes(p.method))
    throw new Error(`Script set an unsupported method: ${p.method}`);
  const mode = BODY_MODES.includes(p.body?.mode) ? p.body.mode : "none";
  return {
    ...cur,
    url: String(p.url ?? ""),
    method: p.method,
    headers: cleanList(p.headers),
    params: cleanList(p.params),
    body: {
      mode,
      ...(["json", "text", "raw"].includes(mode)
        ? { content: String(p.body.content ?? "") }
        : {}),
      ...(["urlencoded", "multipart"].includes(mode)
        ? { fields: cleanList(p.body.fields) }
        : {}),
    },
  };
}
// A post-request script may rewrite what the UI receives (status, headers, body).
function applyResponsePatch(res, p) {
  if (!p) return;
  res.status = Number(p.status);
  res.statusText = String(p.statusText ?? "");
  res.headers = cleanList(p.headers).map(({ key, value }) => ({ key, value }));
  if (p.changed.includes("body")) {
    res.body = String(p.body);
    res.binary = false;
    res.size = Buffer.byteLength(res.body);
  }
  res.contentType =
    res.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ??
    res.contentType;
  res.modifiedByScript = [
    ...new Set([...(res.modifiedByScript ?? []), ...p.changed]),
  ];
}

export async function runRequest(
  db,
  { wid, req, collectionId, environmentId, canPersist, runtime = {}, limits },
) {
  const logs = [];
  const log = (level, message, context) =>
    logs.push({ ts: new Date().toISOString(), level, message, context });
  const out = { logs, tests: [], response: null, error: null, runtime: {} };
  try {
    log("INFO", "Request started", { method: req.method, url: req.url });
    const ws = db
      .prepare("SELECT variables FROM workspaces WHERE id=?")
      .get(wid);
    const env = environmentId
      ? db
          .prepare("SELECT * FROM environments WHERE id=? AND workspace_id=?")
          .get(environmentId, wid)
      : null;
    const chain = collectionChain(db, collectionId).filter(
      (c) => c.workspace_id === wid,
    );
    let envVars = toMap(parse(env?.variables, []));
    let collVars = {};
    let runVars = { ...runtime };
    const wsVars = parse(ws?.variables, []);
    const globals0 = toMap(wsVars);
    let globals = { ...globals0 };
    let cur = req; // the request as the scripts have reshaped it so far
    let res = null; // the response; post scripts may reshape it before it reaches the UI
    const scopesOf = () =>
      mergeScopes({
        workspace: fromObj(globals),
        environment: fromObj(envVars),
        collections: chain.map((c) => c.variables).concat([fromObj(collVars)]),
        request: cur.variables ?? [],
        runtime: runVars,
      });

    // pm.globals / postman.setGlobalVariable live in the workspace variables (Postman "globals").
    const persistGlobals = () => {
      const keys = new Set([...Object.keys(globals0), ...Object.keys(globals)]);
      if (![...keys].some((k) => globals0[k] !== globals[k])) return;
      const next = wsVars.filter(
        (v) => !(v.key in globals0 && !(v.key in globals)),
      );
      for (const v of next)
        if (v.key in globals && v.enabled !== false) v.value = globals[v.key];
      for (const [key, value] of Object.entries(globals))
        if (!next.some((v) => v.key === key)) next.push({ key, value, enabled: true });
      db.prepare("UPDATE workspaces SET variables=? WHERE id=?").run(j(next), wid);
    };

    const runScripts = async (kind) => {
      const sources = [
        ...chain.map((c) => ({ n: `collection "${c.name}"`, code: c[kind] })),
        { n: "request", code: req[kind] },
      ];
      for (const s of sources) {
        if (!s.code?.trim()) continue;
        const label = kind === "pre_script" ? "Pre-request" : "Post-request";
        log("DEBUG", `${label} script running (${s.n})`);
        const r = await runScript(s.code, {
          variables: runVars,
          environment: envVars,
          collectionVariables: collVars,
          globals,
          scope: scopesOf(),
          request: {
            url: cur.url,
            method: cur.method,
            headers: cur.headers ?? [],
            params: cur.params ?? [],
            body: cur.body ?? { mode: "none" },
          },
          response:
            kind === "post_script"
              ? {
                  status: res.status,
                  statusText: res.statusText,
                  headers: Object.fromEntries(
                    res.headers.map((h) => [h.key, h.value]),
                  ),
                  body: res.binary ? "" : res.body,
                  durationMs: res.durationMs,
                }
              : undefined,
          info: {
            eventName: kind === "pre_script" ? "prerequest" : "test",
            requestName: req.name ?? "",
          },
        });
        runVars = r.variables;
        envVars = r.environment;
        collVars = r.collectionVariables;
        globals = r.globals;
        for (const l of r.logs)
          log(l.level.toUpperCase(), `[script] ${l.message}`, { source: s.n });
        out.tests.push(...r.tests);
        if (!r.ok) {
          log("ERROR", `Script error: ${r.error.message}`, {
            source: s.n,
            stack: r.error.stack,
          });
          if (kind === "pre_script")
            throw Object.assign(
              new Error(`${label} script failed: ${r.error.message}`),
              { phase: "script" },
            );
          continue;
        }
        if (kind === "pre_script") {
          try {
            const next = applyRequestPatch(cur, r.request);
            if (JSON.stringify(next) !== JSON.stringify(cur))
              log("INFO", `Request modified by pre-request script (${s.n})`);
            cur = next;
          } catch (e) {
            log("ERROR", `Script error: ${e.message}`, { source: s.n });
            throw Object.assign(
              new Error(`${label} script failed: ${e.message}`),
              { phase: "script" },
            );
          }
        } else if (r.response) {
          applyResponsePatch(res, r.response);
          log("INFO", `Response modified by post-request script (${s.n})`, {
            changed: r.response.changed,
          });
        }
        log("INFO", `${label} script executed (${s.n})`);
      }
    };
    await runScripts("pre_script");

    const vars = scopesOf();
    const resolved = resolveDeep(cur, vars);
    const inherited =
      [...chain]
        .reverse()
        .map((c) => c.auth)
        .find((a) => a && a.type && a.type !== "inherit") ?? null;
    const unresolved = [
      ...new Set(
        JSON.stringify([
          resolved.url,
          resolved.params,
          resolved.headers,
          resolved.body,
        ]).match(/\{\{[^}]+\}\}/g) ?? [],
      ),
    ];
    if (unresolved.length)
      log("WARN", "Unresolved variables", { variables: unresolved });
    let built;
    try {
      built = await buildRequest(resolved, resolveDeep(inherited, vars));
    } catch (e) {
      log("ERROR", `Validation error: ${e.message}`);
      throw Object.assign(e, { phase: "validation" });
    }
    if (BODYLESS_METHODS.includes(built.method) && resolved.body?.mode !== "none")
      log("WARN", `${built.method} requests are sent without a body; the body was ignored`);
    log("INFO", "Request sent", { method: built.method, url: built.url });
    if (canPersist)
      out.sent = {
        method: built.method,
        url: built.url,
        headers: Object.entries(built.headers).map(([key, value]) => ({
          key,
          value,
        })),
        body: built.body == null ? null : String(built.body).slice(0, 20000),
        modified:
          JSON.stringify([cur.url, cur.method, cur.headers, cur.params, cur.body]) !==
          JSON.stringify([req.url, req.method, req.headers, req.params, req.body]),
      };
    try {
      res = await execute(built, { limits });
    } catch (e) {
      // AggregateError (dual-stack attempts) hides per-address causes; surface them.
      const causes = [
        ...new Set(
          (e.errors ?? []).map(
            (x) =>
              `${x.code ?? x.message}${x.address ? " " + x.address + ":" + x.port : ""}`,
          ),
        ),
      ];
      const reason = causes.length
        ? `${e.code ?? "Connection failed"} — ${causes.join("; ")}`
        : e.code === "SSRF_BLOCKED"
          ? e.message
          : e.code === "ETIMEDOUT"
            ? "Connection timeout"
            : e.code === "ENOTFOUND"
              ? "DNS lookup failed (host not found)"
              : e.code === "ECONNREFUSED"
                ? "Connection refused"
                : e.message;
      log("ERROR", `Network error: ${reason}`, {
        url: built.url,
        code: e.code,
      });
      throw Object.assign(
        new Error(`Unable to connect to: ${built.url}\nReason: ${reason}`),
        { phase: "network", userMessage: true },
      );
    }
    out.response = res;
    log(
      "INFO",
      `Response received: ${res.status} ${res.statusText} in ${res.durationMs}ms`,
      { size: res.size },
    );
    if (res.status === 401 || res.status === 403)
      log("WARN", "Authentication error: server rejected credentials", {
        status: res.status,
      });
    await runScripts("post_script");
    if (canPersist) persistGlobals();
    if (canPersist && env)
      db.prepare("UPDATE environments SET variables=? WHERE id=?").run(
        j(
          fromObj(envVars).map((v) => ({
            ...v,
            ...(parse(env.variables, []).find((o) => o.key === v.key)?.secret
              ? { secret: true }
              : {}),
          })),
        ),
        env.id,
      );
    out.runtime = {
      variables: runVars,
      environment: envVars,
      collectionVariables: collVars,
      globals,
    };
    out.resolvedUrl = built.url;
  } catch (e) {
    out.error = { phase: e.phase ?? "internal", message: e.message };
    if (!e.phase) log("ERROR", `Internal error: ${e.message}`);
  }
  return out;
}

/**
 * Variables and inherited auth for requests that are not run through `runRequest` (live sessions).
 * Same scopes as an HTTP run, without scripts: runtime > request > collection > environment > workspace.
 */
export function sessionContext(db, { wid, request, collectionId, environmentId }) {
  const ws = db.prepare("SELECT variables FROM workspaces WHERE id=?").get(wid);
  const env = environmentId
    ? db.prepare("SELECT variables FROM environments WHERE id=? AND workspace_id=?").get(environmentId, wid)
    : null;
  const chain = collectionChain(db, collectionId).filter((c) => c.workspace_id === wid);
  const vars = mergeScopes({
    workspace: parse(ws?.variables, []),
    environment: parse(env?.variables, []),
    collections: chain.map((c) => c.variables),
    request: request.variables ?? [],
  });
  const inherited =
    [...chain].reverse().map((c) => c.auth).find((a) => a && a.type && a.type !== "inherit") ?? null;
  return { vars, inherited: resolveDeep(inherited, vars), request: resolveDeep(request, vars) };
}
