import { parse, j } from "../db/index.js";
import { mergeScopes, resolve, resolveDeep, toMap } from "./variables.js";
import { buildRequest, execute } from "./executor.js";
import { runScript } from "./scriptEngine.js";

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

export async function runRequest(
  db,
  { wid, req, collectionId, environmentId, canPersist, runtime = {} },
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
    const scopesOf = () =>
      mergeScopes({
        workspace: parse(ws?.variables, []),
        environment: fromObj(envVars),
        collections: chain.map((c) => c.variables).concat([fromObj(collVars)]),
        request: req.variables ?? [],
        runtime: runVars,
      });

    const extraHeaders = {};
    const runScripts = async (kind, response) => {
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
          request: { url: req.url, method: req.method },
          response,
        });
        runVars = r.variables;
        envVars = r.environment;
        collVars = r.collectionVariables;
        Object.assign(extraHeaders, r.requestHeaders);
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
        } else log("INFO", `${label} script executed (${s.n})`);
      }
    };
    await runScripts("pre_script");

    const vars = scopesOf();
    const resolved = resolveDeep(
      { ...req, headers: [...(req.headers ?? []), ...fromObj(extraHeaders)] },
      vars,
    );
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
    log("INFO", "Request sent", { method: built.method, url: built.url });
    let res;
    try {
      res = await execute(built);
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
    await runScripts("post_script", {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.map((h) => [h.key, h.value])),
      body: res.binary ? "" : res.body,
      durationMs: res.durationMs,
    });
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
    };
    out.resolvedUrl = built.url;
  } catch (e) {
    out.error = { phase: e.phase ?? "internal", message: e.message };
    if (!e.phase) log("ERROR", `Internal error: ${e.message}`);
  }
  return out;
}
