import { Router } from "express";
import { z } from "zod";
import { requireWorkspace } from "../middleware/auth.js";
import { runRequest } from "../services/runner.js";
import { RequestSchema } from "./content.js";
import { describeProto } from "../protocols/grpc.js";
import { analyze, introspectionQuery, schemaFromIntrospection } from "../protocols/graphql.js";

/** Helpers the editor needs while you write a request: read a .proto, analyse a GraphQL document, fetch a GraphQL schema. */
export function protocolToolsRouter(db) {
  const r = Router({ mergeParams: true });
  const W = (perm) => requireWorkspace(db, perm);
  const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

  r.post("/grpc/describe", W("request:run"), wrap(async (req, res) => {
    const b = z.object({ proto: z.string().max(500_000) }).parse(req.body);
    res.json(await describeProto(b.proto));
  }));

  r.post("/graphql/analyze", W("request:run"), wrap(async (req, res) => {
    const b = z.object({ query: z.string().max(1_000_000), operationName: z.string().max(200).default("") }).parse(req.body);
    res.json(analyze(b.query, b.operationName));
  }));

  // Runs the introspection query like a normal GraphQL request (same auth, variables, scripts and address checks)
  r.post("/graphql/introspect", W("request:run"), wrap(async (req, res) => {
    const b = z.object({
      request: RequestSchema.omit({ name: true }).extend({ name: z.string().optional() }),
      collection_id: z.string().nullable().optional(),
      environment_id: z.string().nullable().optional(),
      limits: z.object({ timeoutMs: z.number().int().min(0).max(3_600_000).optional(), maxResponseBytes: z.number().int().min(0).max(4 * 1024 ** 3).optional() }).optional(),
    }).parse(req.body);
    const out = await runRequest(db, {
      wid: req.wid, collectionId: b.collection_id, environmentId: b.environment_id, limits: b.limits, canPersist: false,
      req: { ...b.request, protocol: "graphql", method: "POST", protocol_data: { ...b.request.protocol_data, query: introspectionQuery(), variables: "", operationName: "", httpMethod: "POST" } },
    });
    if (out.error) return res.json({ ok: false, error: out.error.message });
    const { status, body, binary } = out.response;
    let json;
    try { json = binary ? null : JSON.parse(body); } catch { json = null; }
    if (!json || typeof json !== "object") return res.json({ ok: false, error: `The server answered ${status} with something that is not JSON` });
    if (!json.data?.__schema) return res.json({ ok: false, error: json.errors?.map((e) => e.message).join("; ") || `No schema in the answer (status ${status}); introspection may be disabled on this server` });
    try { res.json({ ok: true, ...schemaFromIntrospection(json.data) }); } catch (e) { res.json({ ok: false, error: `Could not read the schema: ${e.message}` }); }
  }));
  return r;
}
