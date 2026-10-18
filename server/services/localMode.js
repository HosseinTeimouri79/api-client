import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../middleware/auth.js";
import { startRun } from "./runner.js";
import { effectiveLimits, toWire, wireLimits } from "../../core/executor.js";

/**
 * Local mode: the server prepares a run (scripts, variables, auth, the built request), the browser has the Local Agent
 * send it from the user's computer, and reports what came back so the server can finish the run (post-request scripts,
 * tests, saved variables, history). Same pipeline as Server mode; only the network call happens elsewhere.
 */
export const assertLocalMode = () => {
  if (!config.localAgent) throw new HttpError(403, "Local mode is disabled on this server");
};

const header = z.object({ key: z.string().max(10_000), value: z.string().max(1_000_000) });
// What the Local Agent answered, as the browser forwards it: the response, or why the request could not be sent.
export const AgentResultSchema = z.union([
  z.object({
    response: z.object({
      status: z.number().int().min(0).max(999),
      statusText: z.string().max(1000).default(""),
      durationMs: z.number().min(0).default(0),
      size: z.number().int().min(0).default(0),
      headers: z.array(header).max(2000).default([]),
      contentType: z.string().max(1000).default(""),
      redirects: z.array(z.string().max(8000)).max(20).default([]),
      binary: z.boolean().default(false),
      body: z.string().default(""),
    }),
  }),
  z.object({
    error: z.object({
      code: z.string().max(100).optional(),
      message: z.string().max(5000),
      errors: z
        .array(z.object({ code: z.string().max(100).optional(), message: z.string().max(1000).optional(), address: z.string().max(100).optional(), port: z.number().int().optional() }))
        .max(20)
        .optional(),
    }),
  }),
]);

/** A forwarded result, checked against the run's size limit (the agent applies it too, but the browser is not trusted). */
export function acceptResult(r, maxBytes) {
  if (r.error) return { error: r.error };
  const res = r.response;
  const size = res.binary ? Buffer.from(res.body, "base64").length : Buffer.byteLength(res.body);
  if (size > maxBytes) return { error: { message: `Response exceeds ${maxBytes} bytes` } };
  return { response: { ...res, size } };
}

/**
 * Phase one of a Local-mode run. Answers `{ done: true, result }` when there is nothing to send (a pre-request script or
 * the request itself failed), otherwise `{ runId, request, limits }` for the agent. `onDone(out)` records the outcome.
 */
export async function prepareLocalRun(db, pending, { userId, wid, limits, onDone, ...opts }) {
  assertLocalMode();
  const lim = effectiveLimits(limits);
  const run = await startRun(db, { ...opts, wid, via: "local" });
  if (!run.built) return { done: true, result: onDone(run.out) };
  // waits as long as the request may take, plus time for the browser to report back
  const ttlMs = Math.min(Number.isFinite(lim.timeoutMs) ? lim.timeoutMs : 3_600_000, 3_600_000) + 60_000;
  const runId = pending.add({ userId, wid, ttlMs, finish: run.finish, maxBytes: lim.maxBytes, onDone });
  if (!runId) throw new HttpError(429, "Too many requests are waiting for the Local Agent; wait for them to finish");
  return { runId, request: toWire(run.built), limits: wireLimits(lim) };
}

/** Phase two: the agent's answer (or why it could not be reached) finishes the run. */
export async function completeLocalRun(pending, { runId, userId, wid, result }) {
  const parsed = AgentResultSchema.parse(result); // a malformed report does not use up the run
  const run = pending.take(runId, userId, wid);
  if (!run) throw new HttpError(404, "Run not found (it may have expired)");
  const out = await run.finish(acceptResult(parsed, run.maxBytes));
  return run.onDone(out);
}
