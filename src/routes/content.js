import { Router } from "express";
import { z } from "zod";
import { uid, j, parse } from "../db/index.js";
import { HttpError, requireWorkspace, audit } from "../middleware/auth.js";
import { can } from "../services/permissions.js";
import { runRequest, collectionChain } from "../services/runner.js";
import { HTTP_METHODS, IMPLEMENTED } from "../protocols/index.js";

export const kv = z
  .array(
    z.object({
      key: z.string().max(500),
      value: z.string().max(100000).default(""),
      enabled: z.boolean().optional(),
      secret: z.boolean().optional(),
    }),
  )
  .max(500);
export const auth = z
  .object({
    type: z.enum(["inherit", "none", "bearer", "basic", "apikey"]),
    token: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    key: z.string().optional(),
    value: z.string().optional(),
    in: z.enum(["header", "query"]).optional(),
  })
  .nullable();
export const RequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(10000).default(""),
  protocol: z.enum(IMPLEMENTED).default("http"),
  // protocol specific settings (validated when the request is run)
  protocol_data: z
    .record(z.string(), z.unknown())
    .default({})
    .refine((d) => JSON.stringify(d).length <= 2_000_000, "protocol_data is too large"),
  method: z.enum(HTTP_METHODS).default("GET"),
  url: z.string().max(8000).default(""),
  params: kv.default([]),
  headers: kv.default([]),
  variables: kv.default([]),
  auth: auth.default(null),
  body: z
    .object({
      mode: z.enum(["none", "json", "text", "urlencoded", "multipart", "raw"]),
      content: z.string().max(5_000_000).optional(),
      fields: kv.optional(),
    })
    .default({ mode: "none" }),
  pre_script: z.string().max(100000).default(""),
  post_script: z.string().max(100000).default(""),
});
const reqOut = (r) => ({
  ...r,
  protocol_data: parse(r.protocol_data, {}),
  params: parse(r.params, []),
  headers: parse(r.headers, []),
  variables: parse(r.variables, []),
  body: parse(r.body, { mode: "none" }),
  auth: parse(r.auth, null),
});
const colOut = (c) => ({
  ...c,
  variables: parse(c.variables, []),
  auth: parse(c.auth, null),
});

export function contentRouter(db) {
  const r = Router({ mergeParams: true });
  const W = (p) => requireWorkspace(db, p);
  const col = (req, id) => {
    const c = db
      .prepare("SELECT * FROM collections WHERE id=? AND workspace_id=?")
      .get(id, req.wid);
    if (!c) throw new HttpError(404, "Collection not found");
    return c;
  };
  const rq = (req, id) => {
    const c = db
      .prepare("SELECT * FROM requests WHERE id=? AND workspace_id=?")
      .get(id, req.wid);
    if (!c) throw new HttpError(404, "Request not found");
    return c;
  };
  const nextPos = (table, where, ...args) =>
    db
      .prepare(
        `SELECT COALESCE(MAX(position),-1)+1 AS p FROM ${table} WHERE ${where}`,
      )
      .get(...args).p;
  const isDescendant = (id, ancestorId) => {
    let cur = id,
      g = 0;
    while (cur && g++ < 100) {
      if (cur === ancestorId) return true;
      cur = db
        .prepare("SELECT parent_id FROM collections WHERE id=?")
        .get(cur)?.parent_id;
    }
    return false;
  };

  // Lightweight tree (no bodies/scripts) -> cheap to load; details fetched lazily per request.
  r.get("/tree", W("workspace:read"), (req, res) =>
    res.json({
      collections: db
        .prepare(
          "SELECT id,parent_id,name,position,(length(trim(pre_script, ' '||char(9)||char(10)||char(13)))>0) AS has_pre,(length(trim(post_script, ' '||char(9)||char(10)||char(13)))>0) AS has_post FROM collections WHERE workspace_id=? ORDER BY position,name",
        )
        .all(req.wid)
        .map((c) => ({ ...c, has_pre: !!c.has_pre, has_post: !!c.has_post })),
      requests: db
        .prepare(
          "SELECT id,collection_id,name,protocol,method,position FROM requests WHERE workspace_id=? ORDER BY position,name",
        )
        .all(req.wid),
    }),
  );

  // ---- collections ----
  const colBody = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(10000).optional(),
    parent_id: z.string().nullable().optional(),
  });
  r.post("/collections", W("content:write"), (req, res) => {
    const b = colBody.parse(req.body);
    if (b.parent_id) col(req, b.parent_id);
    const id = uid();
    db.prepare(
      "INSERT INTO collections(id,workspace_id,parent_id,name,description,position) VALUES(?,?,?,?,?,?)",
    ).run(
      id,
      req.wid,
      b.parent_id ?? null,
      b.name,
      b.description ?? "",
      nextPos(
        "collections",
        "workspace_id=? AND parent_id IS ?",
        req.wid,
        b.parent_id ?? null,
      ),
    );
    audit(db, req, "collection.create", id);
    res.status(201).json({ id, name: b.name, parent_id: b.parent_id ?? null });
  });
  r.get("/collections/:id", W("workspace:read"), (req, res) =>
    res.json(colOut(col(req, req.params.id))),
  );
  // Scripts inherited by requests in this collection: ancestors (root -> leaf) that actually define a pre/post script.
  // Mirrors the execution order in services/runner.js so the UI can show exactly what will run before/after a request.
  r.get("/collections/:id/scripts", W("workspace:read"), (req, res) => {
    col(req, req.params.id);
    const chain = collectionChain(db, req.params.id).filter(
      (c) => c.workspace_id === req.wid,
    );
    const names = [];
    res.json(
      chain
        .map((c) => {
          names.push(c.name);
          return {
            id: c.id,
            name: c.name,
            path: names.join(" / "),
            pre_script: c.pre_script ?? "",
            post_script: c.post_script ?? "",
          };
        })
        .filter((c) => c.pre_script.trim() || c.post_script.trim()),
    );
  });
  // The auth a request inherits: the nearest collection up the chain that sets one (used by the code snippet view).
  r.get("/collections/:id/auth", W("workspace:read"), (req, res) => {
    col(req, req.params.id);
    const chain = collectionChain(db, req.params.id).filter(
      (c) => c.workspace_id === req.wid,
    );
    const auth =
      [...chain]
        .reverse()
        .map((c) => c.auth)
        .find((a) => a && a.type && a.type !== "inherit") ?? null;
    res.json({ auth });
  });
  r.patch("/collections/:id", W("content:write"), (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(200),
        description: z.string().max(10000),
        variables: kv,
        auth,
        pre_script: z.string().max(100000),
        post_script: z.string().max(100000),
        parent_id: z.string().nullable(),
        position: z.number().int().min(0),
      })
      .partial()
      .parse(req.body);
    const c = col(req, req.params.id);
    if (b.parent_id !== undefined) {
      if (b.parent_id) {
        col(req, b.parent_id);
        if (isDescendant(b.parent_id, c.id))
          throw new HttpError(
            400,
            "Cannot move a collection into itself or its descendants",
          );
      }
    }
    const m = {
      name: b.name ?? c.name,
      description: b.description ?? c.description ?? "",
      variables: j(b.variables ?? parse(c.variables, [])),
      auth: j(b.auth !== undefined ? b.auth : parse(c.auth, null)),
      pre: b.pre_script ?? c.pre_script,
      post: b.post_script ?? c.post_script,
      parent: b.parent_id !== undefined ? b.parent_id : c.parent_id,
      pos:
        b.position ??
        (b.parent_id !== undefined
          ? nextPos(
              "collections",
              "workspace_id=? AND parent_id IS ?",
              req.wid,
              b.parent_id,
            )
          : c.position),
    };
    db.prepare(
      "UPDATE collections SET name=?,description=?,variables=?,auth=?,pre_script=?,post_script=?,parent_id=?,position=? WHERE id=?",
    ).run(m.name, m.description, m.variables, m.auth, m.pre, m.post, m.parent, m.pos, c.id);
    audit(db, req, "collection.update", c.id);
    res.json({ ok: true });
  });
  r.delete("/collections/:id", W("content:write"), (req, res) => {
    col(req, req.params.id);
    audit(db, req, "collection.delete", req.params.id);
    db.prepare("DELETE FROM collections WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  r.post("/collections/:id/duplicate", W("content:write"), (req, res) => {
    const src = col(req, req.params.id);
    const copy = (c, parent, name) => {
      const id = uid();
      db.prepare(
        "INSERT INTO collections(id,workspace_id,parent_id,name,description,position,variables,auth,pre_script,post_script) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        req.wid,
        parent,
        name,
        c.description ?? "",
        nextPos(
          "collections",
          "workspace_id=? AND parent_id IS ?",
          req.wid,
          parent,
        ),
        c.variables,
        c.auth,
        c.pre_script,
        c.post_script,
      );
      for (const q of db
        .prepare("SELECT * FROM requests WHERE collection_id=?")
        .all(c.id))
        db.prepare(
          "INSERT INTO requests(id,workspace_id,collection_id,name,description,position,protocol,protocol_data,method,url,params,headers,body,auth,variables,pre_script,post_script) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          uid(),
          req.wid,
          id,
          q.name,
          q.description,
          q.position,
          q.protocol,
          q.protocol_data,
          q.method,
          q.url,
          q.params,
          q.headers,
          q.body,
          q.auth,
          q.variables,
          q.pre_script,
          q.post_script,
        );
      for (const s of db
        .prepare("SELECT * FROM collections WHERE parent_id=?")
        .all(c.id))
        copy(s, id, s.name);
      return id;
    };
    db.exec("BEGIN");
    try {
      const id = copy(src, src.parent_id, `${src.name} (copy)`);
      db.exec("COMMIT");
      res.status(201).json({ id });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });

  // ---- requests ----
  r.post("/collections/:id/requests", W("content:write"), (req, res) => {
    col(req, req.params.id);
    const b = RequestSchema.parse(req.body);
    const id = uid();
    db.prepare(
      "INSERT INTO requests(id,workspace_id,collection_id,name,description,position,protocol,protocol_data,method,url,params,headers,body,auth,variables,pre_script,post_script) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      req.wid,
      req.params.id,
      b.name,
      b.description,
      nextPos("requests", "collection_id=?", req.params.id),
      b.protocol,
      j(b.protocol_data),
      b.method,
      b.url,
      j(b.params),
      j(b.headers),
      j(b.body),
      j(b.auth),
      j(b.variables),
      b.pre_script,
      b.post_script,
    );
    audit(db, req, "request.create", id);
    res.status(201).json(reqOut(rq(req, id)));
  });
  r.get("/requests/:id", W("workspace:read"), (req, res) =>
    res.json(reqOut(rq(req, req.params.id))),
  );
  r.put("/requests/:id", W("content:write"), (req, res) => {
    rq(req, req.params.id);
    const b = RequestSchema.parse(req.body);
    db.prepare(
      "UPDATE requests SET name=?,description=?,protocol=?,protocol_data=?,method=?,url=?,params=?,headers=?,body=?,auth=?,variables=?,pre_script=?,post_script=?,updated_at=datetime('now') WHERE id=?",
    ).run(
      b.name,
      b.description,
      b.protocol,
      j(b.protocol_data),
      b.method,
      b.url,
      j(b.params),
      j(b.headers),
      j(b.body),
      j(b.auth),
      j(b.variables),
      b.pre_script,
      b.post_script,
      req.params.id,
    );
    audit(db, req, "request.update", req.params.id);
    res.json(reqOut(rq(req, req.params.id)));
  });
  r.patch("/requests/:id/move", W("content:write"), (req, res) => {
    const b = z
      .object({
        collection_id: z.string(),
        position: z.number().int().min(0).optional(),
      })
      .parse(req.body);
    rq(req, req.params.id);
    col(req, b.collection_id);
    db.prepare("UPDATE requests SET collection_id=?,position=? WHERE id=?").run(
      b.collection_id,
      b.position ?? nextPos("requests", "collection_id=?", b.collection_id),
      req.params.id,
    );
    res.json({ ok: true });
  });
  r.post("/requests/:id/duplicate", W("content:write"), (req, res) => {
    const q = rq(req, req.params.id),
      id = uid();
    db.prepare(
      "INSERT INTO requests(id,workspace_id,collection_id,name,description,position,protocol,protocol_data,method,url,params,headers,body,auth,variables,pre_script,post_script) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      req.wid,
      q.collection_id,
      `${q.name} (copy)`,
      q.description,
      nextPos("requests", "collection_id=?", q.collection_id),
      q.protocol,
      q.protocol_data,
      q.method,
      q.url,
      q.params,
      q.headers,
      q.body,
      q.auth,
      q.variables,
      q.pre_script,
      q.post_script,
    );
    res.status(201).json({ id });
  });
  r.delete("/requests/:id", W("content:write"), (req, res) => {
    rq(req, req.params.id);
    audit(db, req, "request.delete", req.params.id);
    db.prepare("DELETE FROM requests WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  // Bulk reorder (drag & drop): [{type:'collection'|'request', id, position}]
  r.post("/reorder", W("content:write"), (req, res) => {
    const items = z
      .array(
        z.object({
          type: z.enum(["collection", "request"]),
          id: z.string(),
          position: z.number().int().min(0),
        }),
      )
      .max(1000)
      .parse(req.body);
    db.exec("BEGIN");
    try {
      for (const i of items)
        db.prepare(
          `UPDATE ${i.type === "collection" ? "collections" : "requests"} SET position=? WHERE id=? AND workspace_id=?`,
        ).run(i.position, i.id, req.wid);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.json({ ok: true });
  });

  // ---- execution ----
  // Viewers may run requests (permission request:run) but the server never persists anything for them.
  r.post("/run", W("request:run"), async (req, res) => {
    const b = z
      .object({
        request: RequestSchema.omit({ name: true }).extend({
          name: z.string().optional(),
        }),
        collection_id: z.string().nullable().optional(),
        environment_id: z.string().nullable().optional(),
        // per-user request limits from Settings (0 = as much as the server allows)
        limits: z
          .object({
            timeoutMs: z.number().int().min(0).max(3_600_000).optional(),
            maxResponseBytes: z.number().int().min(0).max(4 * 1024 ** 3).optional(),
          })
          .optional(),
      })
      .parse(req.body);
    if (b.collection_id) col(req, b.collection_id);
    const out = await runRequest(db, {
      limits: b.limits,
      wid: req.wid,
      req: b.request,
      collectionId: b.collection_id,
      environmentId: b.environment_id,
      canPersist: can(req.role, "content:write"),
    });
    const id = uid(); // history stores the unresolved request (never resolved secrets) + outcome
    db.prepare(
      "INSERT INTO history(id,user_id,workspace_id,method,url,status,duration_ms,snapshot) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      id,
      req.user.id,
      req.wid,
      b.request.method,
      b.request.url,
      out.response?.status ?? null,
      out.response?.durationMs ?? null,
      j({ request: b.request, collection_id: b.collection_id ?? null }),
    );
    res.json(out);
  });

  // ---- history (per user, per workspace) ----
  r.get("/history", W("workspace:read"), (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,method,url,status,duration_ms,created_at FROM history WHERE user_id=? AND workspace_id=? ORDER BY created_at DESC, rowid DESC LIMIT 200",
        )
        .all(req.user.id, req.wid),
    ),
  );
  r.get("/history/:id", W("workspace:read"), (req, res) => {
    const h = db
      .prepare(
        "SELECT * FROM history WHERE id=? AND user_id=? AND workspace_id=?",
      )
      .get(req.params.id, req.user.id, req.wid);
    if (!h) throw new HttpError(404, "Not found");
    res.json({ ...h, snapshot: parse(h.snapshot, {}) });
  });
  r.delete("/history", W("workspace:read"), (req, res) => {
    db.prepare("DELETE FROM history WHERE user_id=? AND workspace_id=?").run(
      req.user.id,
      req.wid,
    );
    res.json({ ok: true });
  });
  return r;
}
