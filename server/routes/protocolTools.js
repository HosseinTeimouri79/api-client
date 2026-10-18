import { Router } from "express";
import { z } from "zod";
import { requireWorkspace } from "../middleware/auth.js";
import { runRequest } from "../services/runner.js";
import { RunSchema } from "./content.js";
import { PendingRuns } from "../services/pendingRuns.js";
import { prepareLocalRun, completeLocalRun } from "../services/localMode.js";
import { describeProto } from "../../core/protocols/grpc.js";
import { analyze, introspectionQuery, schemaFromIntrospection } from "../../core/protocols/graphql.js";

/** Helpers the editor needs while you write a request: read a .proto, analyse a GraphQL document, fetch a GraphQL schema. */
// The introspection query as a GraphQL request with the tab's address, auth and variables.
const introspectionRequest = (request) => ({
  ...request, protocol: "graphql", method: "POST",
  protocol_data: { ...request.protocol_data, query: introspectionQuery(), variables: "", operationName: "", httpMethod: "POST" },
});
/** The schema from the run's answer, or why there is none. */
function schemaResult(out) {
  if (out.error) return { ok: false, error: out.error.message };
  const { status, body, binary } = out.response;
  let json;
  try { json = binary ? null : JSON.parse(body); } catch { json = null; }
  if (!json || typeof json !== "object") return { ok: false, error: `The server answered ${status} with something that is not JSON` };
  if (!json.data?.__schema) return { ok: false, error: json.errors?.map((e) => e.message).join("; ") || `No schema in the answer (status ${status}); introspection may be disabled on this server` };
  try { return { ok: true, ...schemaFromIntrospection(json.data) }; } catch (e) { return { ok: false, error: `Could not read the schema: ${e.message}` }; }
}

export function protocolToolsRouter(db, pending = new PendingRuns()) {
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
    const b = RunSchema.parse(req.body);
    res.json(schemaResult(await runRequest(db, {
      wid: req.wid, collectionId: b.collection_id, environmentId: b.environment_id, limits: b.limits, canPersist: false, req: introspectionRequest(b.request),
    })));
  }));
  // Local mode: the Local Agent sends the introspection query (see services/localMode.js)
  r.post("/graphql/introspect/prepare", W("request:run"), wrap(async (req, res) => {
    const b = RunSchema.parse(req.body);
    res.json(await prepareLocalRun(db, pending, {
      wid: req.wid, userId: req.user.id, collectionId: b.collection_id, environmentId: b.environment_id, limits: b.limits, canPersist: false,
      req: introspectionRequest(b.request), onDone: schemaResult,
    }));
  }));
  r.post("/graphql/introspect/:runId/complete", W("request:run"), wrap(async (req, res) => {
    res.json(await completeLocalRun(pending, { runId: req.params.runId, userId: req.user.id, wid: req.wid, result: req.body }));
  }));
  return r;
}
