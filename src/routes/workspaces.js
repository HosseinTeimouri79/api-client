import { Router } from "express";
import { z } from "zod";
import { uid, j, parse } from "../db/index.js";
import { HttpError, requireWorkspace, audit, withAvatar } from "../middleware/auth.js";
import { ROLES, outranks, can } from "../services/permissions.js";

const kvList = z
  .array(
    z.object({
      key: z.string().max(200),
      value: z.string().max(10000).default(""),
      enabled: z.boolean().optional(),
      secret: z.boolean().optional(),
    }),
  )
  .max(500);

export function workspaceRouter(db) {
  const r = Router();
  r.get("/", (req, res) =>
    res.json(
      db
        .prepare(
          `SELECT w.id,w.name,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.name`,
        )
        .all(req.user.id),
    ),
  );
  r.post("/", (req, res) => {
    const { name } = z
      .object({ name: z.string().min(1).max(100) })
      .parse(req.body);
    const id = uid();
    db.prepare("INSERT INTO workspaces(id,name,owner_id) VALUES(?,?,?)").run(
      id,
      name,
      req.user.id,
    );
    db.prepare("INSERT INTO workspace_members VALUES(?,?, 'owner')").run(
      id,
      req.user.id,
    );
    res.status(201).json({ id, name, role: "owner" });
  });
  const W = (perm) => requireWorkspace(db, perm);
  r.get("/:wid", W("workspace:read"), (req, res) => {
    const w = db
      .prepare("SELECT id,name,variables FROM workspaces WHERE id=?")
      .get(req.wid);
    res.json({ ...w, variables: parse(w.variables, []), role: req.role });
  });
  r.patch("/:wid", W("workspace:update"), (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(100).optional(),
        variables: kvList.optional(),
      })
      .parse(req.body);
    if (b.name)
      db.prepare("UPDATE workspaces SET name=? WHERE id=?").run(
        b.name,
        req.wid,
      );
    if (b.variables)
      db.prepare("UPDATE workspaces SET variables=? WHERE id=?").run(
        j(b.variables),
        req.wid,
      );
    audit(db, req, "workspace.update");
    res.json({ ok: true });
  });
  r.delete("/:wid", W("workspace:delete"), (req, res) => {
    audit(db, req, "workspace.delete");
    db.prepare("DELETE FROM workspaces WHERE id=?").run(req.wid);
    res.json({ ok: true });
  });

  // ---- members / sharing ----
  r.get("/:wid/members", W("workspace:read"), (req, res) =>
    res.json(
      withAvatar(
        db
          .prepare(
            "SELECT u.id,u.name,u.username,u.avatar_v,m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.role,u.name",
          )
          .all(req.wid),
      ),
    ),
  );
  // Everyone who is not yet in this workspace, for the "add people" picker (searchable, capped).
  r.get("/:wid/members/candidates", W("members:manage"), (req, res) => {
    const { q, limit } = z
      .object({
        q: z.string().max(100).default(""),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    res.json(
      withAvatar(
        db
          .prepare(
            `SELECT id,username,name,avatar_v FROM users
           WHERE id NOT IN (SELECT user_id FROM workspace_members WHERE workspace_id=?)
             AND (?='' OR instr(lower(username),lower(?))>0 OR instr(lower(name),lower(?))>0)
           ORDER BY name COLLATE NOCASE, username LIMIT ?`,
          )
          .all(req.wid, q, q, q, limit),
      ),
    );
  });
  r.post("/:wid/members", W("members:manage"), (req, res) => {
    // add existing users by id (picker) or by username
    const b = z
      .object({
        user_ids: z.array(z.string().max(100)).min(1).max(100).optional(),
        username: z.string().min(1).max(100).optional(),
        role: z.enum(ROLES),
      })
      .refine((x) => x.user_ids || x.username, "user_ids or username required")
      .parse(req.body);
    const { role } = b;
    if (role === "owner" || (role === "admin" && req.role !== "owner"))
      throw new HttpError(
        403,
        "Only the owner can grant admin; ownership is not grantable",
      );
    const users = b.user_ids
      ? [...new Set(b.user_ids)].map((id) => db.prepare("SELECT id FROM users WHERE id=?").get(id))
      : [db.prepare("SELECT id FROM users WHERE username=?").get(b.username.toLowerCase())];
    if (users.some((u) => !u)) throw new HttpError(404, "User not found");
    const isMember = db.prepare(
      "SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=?",
    );
    if (users.some((u) => isMember.get(req.wid, u.id)))
      throw new HttpError(409, "Already a member");
    for (const u of users) {
      db.prepare("INSERT INTO workspace_members VALUES(?,?,?)").run(
        req.wid,
        u.id,
        role,
      );
      audit(db, req, "member.add", `${u.id}:${role}`);
    }
    res.status(201).json({ ok: true, added: users.length });
  });
  const target = (req) => {
    const t = db
      .prepare(
        "SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
      )
      .get(req.wid, req.params.uid);
    if (!t) throw new HttpError(404, "Member not found");
    return t;
  };
  r.patch("/:wid/members/:uid", W("members:manage"), (req, res) => {
    const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body);
    const t = target(req);
    if (t.role === "owner" || role === "owner")
      throw new HttpError(403, "Owner role cannot be changed");
    if (req.params.uid === req.user.id)
      throw new HttpError(403, "You cannot change your own role");
    if (
      req.role !== "owner" &&
      (!outranks(req.role, t.role) || !outranks(req.role, role))
    )
      throw new HttpError(403, "Insufficient permissions for this role change");
    db.prepare(
      "UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?",
    ).run(role, req.wid, req.params.uid);
    audit(db, req, "member.role", `${req.params.uid}:${role}`);
    res.json({ ok: true });
  });
  r.delete(
    "/:wid/members/:uid",
    (req, res, next) => {
      // members may remove themselves (leave); otherwise need members:manage
      if (req.params.uid === req.user.id)
        return requireWorkspace(db, "workspace:read")(req, res, next);
      return W("members:manage")(req, res, next);
    },
    (req, res) => {
      const t = target(req);
      if (t.role === "owner")
        throw new HttpError(403, "Owner cannot be removed");
      if (
        req.params.uid !== req.user.id &&
        req.role !== "owner" &&
        !outranks(req.role, t.role)
      )
        throw new HttpError(403, "Insufficient permissions");
      db.prepare(
        "DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",
      ).run(req.wid, req.params.uid);
      audit(db, req, "member.remove", req.params.uid);
      res.json({ ok: true });
    },
  );

  // ---- environments ----
  r.get("/:wid/environments", W("workspace:read"), (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,variables FROM environments WHERE workspace_id=? ORDER BY name",
        )
        .all(req.wid)
        .map((e) => ({ ...e, variables: parse(e.variables, []) })),
    ),
  );
  r.post("/:wid/environments", W("content:write"), (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        variables: kvList.default([]),
      })
      .parse(req.body);
    const id = uid();
    db.prepare(
      "INSERT INTO environments(id,workspace_id,name,variables) VALUES(?,?,?,?)",
    ).run(id, req.wid, b.name, j(b.variables));
    res.status(201).json({ id, ...b });
  });
  r.put("/:wid/environments/:eid", W("content:write"), (req, res) => {
    const b = z
      .object({ name: z.string().min(1).max(100), variables: kvList })
      .parse(req.body);
    if (
      !db
        .prepare(
          "UPDATE environments SET name=?,variables=? WHERE id=? AND workspace_id=?",
        )
        .run(b.name, j(b.variables), req.params.eid, req.wid).changes
    )
      throw new HttpError(404, "Not found");
    res.json({ ok: true });
  });
  r.delete("/:wid/environments/:eid", W("content:write"), (req, res) => {
    db.prepare("DELETE FROM environments WHERE id=? AND workspace_id=?").run(
      req.params.eid,
      req.wid,
    );
    res.json({ ok: true });
  });

  // ---- audit log (admins) ----
  r.get("/:wid/audit", W("members:manage"), (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT a.id,a.action,a.target,a.created_at,u.name AS user FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT 200",
        )
        .all(req.wid),
    ),
  );
  return r;
}
