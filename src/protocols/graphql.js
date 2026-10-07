import { z } from "zod";
import { parse, buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { effectiveLimits } from "../services/executor.js";
import { newSocket } from "./websocket.js";
import { prepareTarget } from "./common.js";

export const GraphqlData = z.object({
  query: z.string().max(1_000_000).default(""),
  variables: z.string().max(1_000_000).default(""), // JSON object, as text
  operationName: z.string().max(200).default(""), // which operation of the document to run (when it has several)
  httpMethod: z.enum(["POST", "GET"]).default("POST"), // queries and mutations; GET only for queries
  transport: z.enum(["graphql-transport-ws", "graphql-ws"]).default("graphql-transport-ws"), // subscriptions: current and legacy protocol
  wsUrl: z.string().max(8000).default(""), // subscriptions: WebSocket endpoint when it differs from the URL
  connectionParams: z.string().max(100_000).default(""), // JSON sent with connection_init (e.g. an auth token)
});

const fail = (message, phase = "validation") => Object.assign(new Error(message), { phase });

/** Operations in a document (name and type) and which one a run would use. Syntax errors are returned, not thrown. */
export function analyze(query, operationName = "") {
  if (!String(query).trim()) return { ok: true, operations: [], current: null };
  let doc;
  try {
    doc = parse(query);
  } catch (e) {
    const loc = e.locations?.[0];
    return { ok: false, error: e.message.replace(/^Syntax Error: /, ""), line: loc?.line ?? null, column: loc?.column ?? null };
  }
  const operations = doc.definitions.filter((d) => d.kind === "OperationDefinition").map((d) => ({ name: d.name?.value ?? "", type: d.operation }));
  const current = operationName ? operations.find((o) => o.name === operationName) ?? null : operations[0] ?? null;
  return { ok: true, operations, current, ...(operations.length > 1 && !operationName && { ambiguous: true }) };
}

function jsonObject(text, what) {
  if (!String(text ?? "").trim()) return undefined;
  let v;
  try { v = JSON.parse(text); } catch (e) { throw fail(`${what} is not valid JSON: ${e.message}`); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw fail(`${what} must be a JSON object`);
  return v;
}

/** A resolved GraphQL request as the plain HTTP request that carries it (queries and mutations). */
export function graphqlAsHttp(r) {
  const cfg = GraphqlData.parse(r.protocol_data ?? {});
  if (!cfg.query.trim()) throw fail("Write a query first");
  const a = analyze(cfg.query, cfg.operationName);
  if (!a.ok) throw fail(`Invalid GraphQL: ${a.error}${a.line ? ` (line ${a.line}, column ${a.column})` : ""}`);
  if (cfg.operationName && !a.current) throw fail(`The document has no operation named "${cfg.operationName}"`);
  if (a.ambiguous) throw fail("The document has several operations: choose which one to run");
  if (a.current?.type === "subscription") throw fail("Subscriptions use a WebSocket connection: use Subscribe instead of Send");
  const variables = jsonObject(cfg.variables, "Variables");
  const headers = [...(r.headers ?? [])];
  if (!headers.some((h) => h.key?.toLowerCase() === "accept" && h.enabled !== false))
    headers.push({ key: "Accept", value: "application/graphql-response+json, application/json;q=0.9", enabled: true });
  const base = { ...r, headers };
  if (cfg.httpMethod === "GET") {
    if (a.current?.type === "mutation") throw fail("Mutations cannot be sent with GET: use POST");
    const params = [...(r.params ?? []), { key: "query", value: cfg.query }];
    if (variables) params.push({ key: "variables", value: JSON.stringify(variables) });
    if (cfg.operationName) params.push({ key: "operationName", value: cfg.operationName });
    return { ...base, method: "GET", params, body: { mode: "none" } };
  }
  const body = { query: cfg.query, ...(variables && { variables }), ...(cfg.operationName && { operationName: cfg.operationName }) };
  return { ...base, method: "POST", body: { mode: "json", content: JSON.stringify(body) } };
}

export const introspectionQuery = () => getIntrospectionQuery({ descriptions: true });

/** The schema as SDL from an introspection result (the `data` object of the response). */
export function schemaFromIntrospection(data) {
  const schema = buildClientSchema(data);
  const roots = {
    query: schema.getQueryType()?.name ?? null,
    mutation: schema.getMutationType()?.name ?? null,
    subscription: schema.getSubscriptionType()?.name ?? null,
  };
  return { sdl: printSchema(schema), roots };
}

const SCHEMES = { ws: "ws", wss: "wss", http: "ws", https: "wss" };

/**
 * Starts a subscription over WebSocket: graphql-transport-ws (current) or graphql-ws (legacy, subscriptions-transport-ws).
 * Resolves after the server acknowledged the connection and the operation was started.
 */
export function connectSubscription({ request, inherited, data, limits, ctx, vars }) {
  const cfg = GraphqlData.parse(data ?? {});
  const a = analyze(cfg.query, cfg.operationName);
  if (!cfg.query.trim()) throw fail("Write a subscription first");
  if (!a.ok) throw fail(`Invalid GraphQL: ${a.error}${a.line ? ` (line ${a.line}, column ${a.column})` : ""}`);
  if (a.current?.type !== "subscription") throw fail(a.ambiguous ? "The document has several operations: choose which one to run" : "This operation is not a subscription: use Send");
  const variables = jsonObject(cfg.variables, "Variables");
  const params = jsonObject(cfg.connectionParams, "Connection params");
  const modern = cfg.transport === "graphql-transport-ws";
  const { url, headers } = prepareTarget({ ...request, url: cfg.wsUrl.trim() || request.url }, inherited, { schemes: SCHEMES, defaultScheme: "wss" });
  const lim = effectiveLimits(limits);
  const payload = { query: cfg.query, ...(variables && { variables }), ...(cfg.operationName && { operationName: cfg.operationName }) };
  const sock = newSocket(url, [cfg.transport], headers, lim);
  const show = (o) => JSON.stringify(o, null, 2);
  const message = (direction, o) => { const text = show(o); ctx.emit("message", { direction, binary: false, size: Buffer.byteLength(text), data: text }); };
  const send = (o) => sock.send(JSON.stringify(o));
  let upgrade = null, started = false, done = false;
  sock.on("upgrade", (res) => (upgrade = res));
  const end = (data) => { if (!done) { done = true; ctx.finish(data); } };

  return new Promise((resolve, reject) => {
    const timer = Number.isFinite(lim.timeoutMs) ? setTimeout(() => { reject(Object.assign(new Error("Connection timeout: the server did not acknowledge the connection"), { code: "ETIMEDOUT" })); sock.terminate(); }, lim.timeoutMs) : null;
    const driver = {
      async act(action) {
        if (action !== "stop") throw new Error(`Unknown action "${action}"`);
        if (sock.readyState === sock.OPEN) { send({ id: "1", type: modern ? "complete" : "stop" }); sock.close(1000, "unsubscribed"); }
        return { ok: true };
      },
      close() { sock.terminate(); },
    };
    sock.on("open", () => send({ type: "connection_init", ...(params && { payload: params }) }));
    sock.on("message", (raw) => {
      let m;
      try { m = JSON.parse(raw.toString("utf8")); } catch { return ctx.emit("error", { message: "The server sent something that is not JSON" }); }
      switch (m.type) {
        case "connection_ack":
          clearTimeout(timer);
          started = true;
          ctx.emit("open", { url: url.toString(), protocol: cfg.transport, status: upgrade?.statusCode ?? 101, headers: Object.entries(upgrade?.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })), operation: a.current });
          send({ id: "1", type: modern ? "subscribe" : "start", payload });
          message("out", payload);
          resolve(driver);
          break;
        case "ping": send({ type: "pong" }); break;
        case "pong": case "ka": break;
        case "next": case "data": message("in", m.payload); break;
        case "error": ctx.emit("error", { message: show(m.payload) }); break;
        case "connection_error": reject(fail(`The server refused the connection: ${show(m.payload)}`, "network")); sock.terminate(); break;
        case "complete": ctx.emit("completed", {}); sock.close(1000, "complete"); break;
        default: break;
      }
    });
    sock.on("unexpected-response", (_q, res) => { res.resume(); clearTimeout(timer); reject(Object.assign(new Error(`Handshake rejected: ${res.statusCode} ${res.statusMessage ?? ""}`.trim()), { status: res.statusCode, headers: res.headers })); });
    sock.on("error", (e) => {
      const reason = e.code === "SSRF_BLOCKED" ? e.message : e.code === "ECONNREFUSED" ? "Connection refused" : e.code === "ENOTFOUND" ? "DNS lookup failed (host not found)" : e.message;
      clearTimeout(timer);
      if (!started) reject(Object.assign(new Error(reason), { code: e.code }));
      else ctx.emit("error", { message: reason });
    });
    sock.on("close", (code, reason) => {
      clearTimeout(timer);
      if (!started) return reject(new Error(code === 4400 || code === 4401 || code === 4403 ? `The server closed the connection: ${code} ${reason.toString("utf8")}` : "The server closed the connection before acknowledging it (is this a GraphQL WebSocket endpoint that speaks " + cfg.transport + "?)"));
      end({ code, reason: reason.toString("utf8") });
    });
  });
}
