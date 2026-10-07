import { Router } from "express";
import { z } from "zod";
import { uid, j, parse } from "../db/index.js";
import { HttpError, requireWorkspace, audit } from "../middleware/auth.js";
import { RequestSchema, kv, auth } from "./content.js";
import {
  detect,
  parseImport,
  toPostmanCollection,
  toPostmanEnv,
  toHoppCollection,
  toHoppEnv,
} from "../services/interop.js";

const MAX_REQUESTS = 5000,
  MAX_DEPTH = 30;
const FORMATS = ["postman", "hoppscotch"];

export function interopRouter(db) {
  const r = Router({ mergeParams: true });
  const W = (p) => requireWorkspace(db, p);

  // ---- export: GET /export?format=postman|hoppscotch&collection=<id>  |  &environment=<id|all> ----
  r.get("/export", W("workspace:read"), (req, res) => {
    const { format, collection, environment } = z
      .object({
        format: z.enum(FORMATS),
        collection: z.string().optional(),
        environment: z.string().optional(),
      })
      .parse(req.query);
    const safe = (s) =>
      String(s)
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 60) || "export";
    if (environment) {
      const rows = db
        .prepare(
          "SELECT id,name,variables FROM environments WHERE workspace_id=?" +
            (environment === "all" ? "" : " AND id=?"),
        )
        .all(...(environment === "all" ? [req.wid] : [req.wid, environment]))
        .map((e) => ({ ...e, variables: parse(e.variables, []) }));
      if (!rows.length) throw new HttpError(404, "Environment not found");
      if (format === "postman" && rows.length > 1)
        throw new HttpError(
          400,
          "Postman environments are exported one at a time",
        );
      audit(db, req, "environment.export", environment);
      return res.json({
        filename: `${safe(rows[0].name)}.${format}-environment.json`,
        data:
          format === "postman"
            ? toPostmanEnv(rows[0], rows[0].id)
            : rows.map((e) => toHoppEnv(e, e.id)),
      });
    }
    const cols = db
      .prepare(
        "SELECT * FROM collections WHERE workspace_id=? ORDER BY position,name",
      )
      .all(req.wid);
    const reqs = db
      .prepare(
        "SELECT * FROM requests WHERE workspace_id=? ORDER BY position,name",
      )
      .all(req.wid);
    const node = (c, d = 0) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? "",
      variables: parse(c.variables, []),
      auth: parse(c.auth, null),
      pre_script: c.pre_script,
      post_script: c.post_script,
      folders:
        d > MAX_DEPTH
          ? []
          : cols.filter((x) => x.parent_id === c.id).map((x) => node(x, d + 1)),
      requests: reqs
        .filter((x) => x.collection_id === c.id)
        .map((x) => ({
          ...x,
          params: parse(x.params, []),
          headers: parse(x.headers, []),
          variables: parse(x.variables, []),
          body: parse(x.body, { mode: "none" }),
          auth: parse(x.auth, null),
        })),
    });
    const roots = collection
      ? [cols.find((c) => c.id === collection)].filter(Boolean)
      : cols.filter((c) => !c.parent_id);
    if (!roots.length)
      throw new HttpError(
        404,
        collection ? "Collection not found" : "Nothing to export",
      );
    if (format === "postman" && roots.length > 1)
      throw new HttpError(
        400,
        "Postman files hold a single collection: pick one collection to export",
      );
    const warnings = [],
      warn = (m) => warnings.push(m),
      trees = roots.map((c) => node(c));
    audit(db, req, "collection.export", collection ?? "all");
    const data =
      format === "postman"
        ? toPostmanCollection(trees[0], trees[0].id)
        : trees.map((t) => toHoppCollection(t, null, warn));
    res.json({
      filename: `${safe(trees[0].name)}.${format}-collection.json`,
      warnings,
      data,
    });
  });

  // ---- import: POST /import { data, format?, parent_id? } ----
  r.post("/import", W("content:write"), (req, res) => {
    const b = z
      .object({
        data: z.any(),
        format: z
          .enum([
            "postman-collection",
            "postman-environment",
            "hoppscotch-collection",
            "hoppscotch-environment",
          ])
          .optional(),
        parent_id: z.string().nullable().optional(),
        only: z.enum(["collection", "environment"]).optional(),
      })
      .parse(req.body);
    let parsed;
    try {
      parsed = parseImport(b.data, b.format);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    if (b.only === "environment" && parsed.collections.length)
      throw new HttpError(
        400,
        "This file is a collection, not an environment. Use Import / Export for collections.",
      );
    if (b.only === "collection" && parsed.environments.length)
      throw new HttpError(
        400,
        "This file is an environment, not a collection. Import it from Environments.",
      );
    const { warnings } = parsed;
    let nCols = 0,
      nReqs = 0,
      nEnvs = 0;
    if (
      b.parent_id &&
      !db
        .prepare("SELECT 1 FROM collections WHERE id=? AND workspace_id=?")
        .get(b.parent_id, req.wid)
    )
      throw new HttpError(404, "Parent collection not found");
    const pos = (t, w, ...a) =>
      db
        .prepare(
          `SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${t} WHERE ${w}`,
        )
        .get(...a).p;
    const insCol = db.prepare(
      "INSERT INTO collections(id,workspace_id,parent_id,name,description,position,variables,auth,pre_script,post_script) VALUES(?,?,?,?,?,?,?,?,?,?)",
    );
    const insReq = db.prepare(
      "INSERT INTO requests(id,workspace_id,collection_id,name,description,position,method,url,params,headers,body,auth,variables,pre_script,post_script) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const addCol = (n, parent, position, depth) => {
      if (depth > MAX_DEPTH)
        throw new HttpError(400, "Collection nesting is too deep");
      const id = uid(),
        v = kv.safeParse(n.variables),
        a = n.auth ? auth.safeParse(n.auth) : null;
      insCol.run(
        id,
        req.wid,
        parent,
        n.name,
        String(n.description ?? "").slice(0, 10000),
        position,
        j(v.success ? v.data : []),
        j(a?.success ? a.data : null),
        n.pre_script ?? "",
        n.post_script ?? "",
      );
      nCols++;
      n.folders.forEach((f, i) => addCol(f, id, i, depth + 1));
      n.requests.forEach((q, i) => {
        if (++nReqs > MAX_REQUESTS)
          throw new HttpError(400, `Too many requests (max ${MAX_REQUESTS})`);
        const p = RequestSchema.safeParse(q);
        if (!p.success) {
          nReqs--;
          warnings.push(
            `request "${q.name}" skipped: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`,
          );
          return;
        }
        const x = p.data;
        insReq.run(
          uid(),
          req.wid,
          id,
          x.name,
          x.description,
          i,
          x.method,
          x.url,
          j(x.params),
          j(x.headers),
          j(x.body),
          j(x.auth),
          j(x.variables),
          x.pre_script,
          x.post_script,
        );
      });
    };
    db.exec("BEGIN");
    try {
      let base = pos(
        "collections",
        "workspace_id=? AND parent_id IS ?",
        req.wid,
        b.parent_id ?? null,
      );
      for (const c of parsed.collections)
        addCol(c, b.parent_id ?? null, base++, 0);
      for (const e of parsed.environments) {
        const v = kv.safeParse(e.variables);
        db.prepare(
          "INSERT INTO environments(id,workspace_id,name,variables) VALUES(?,?,?,?)",
        ).run(uid(), req.wid, e.name, j(v.success ? v.data : []));
        nEnvs++;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    audit(db, req, "import", parsed.format);
    res
      .status(201)
      .json({
        format: parsed.format,
        collections: nCols,
        requests: nReqs,
        environments: nEnvs,
        warnings,
      });
  });
  return r;
}
export { detect };
