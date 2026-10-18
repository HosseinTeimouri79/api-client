import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { uid } from "../db/index.js";
import {
  HttpError,
  audit,
  requireAdmin,
  withAvatar,
  setCookie,
  signToken,
} from "../middleware/auth.js";
import { usernameSchema } from "./auth.js";
import { registrationOpen, setRegistrationOpen } from "../services/settings.js";

const password = z.string().min(8).max(200);
const name = z.string().trim().min(1).max(100);
const bool = z.boolean();

// Platform administration: user management, workspace overview, activity. Every route needs users.is_admin.
export function adminRouter(db) {
  const r = Router();
  r.use(requireAdmin);

  const userRow = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
  const getUser = (id) => {
    const u = userRow(id);
    if (!u) throw new HttpError(404, "User not found");
    return u;
  };
  const usernameTaken = (username, exceptId = "") =>
    db
      .prepare("SELECT 1 FROM users WHERE username=? AND id<>?")
      .get(username, exceptId);

  r.get("/settings", (_req, res) =>
    res.json({ registration_open: registrationOpen(db) }),
  );
  r.patch("/settings", (req, res) => {
    const b = z.object({ registration_open: bool }).parse(req.body);
    setRegistrationOpen(db, b.registration_open);
    audit(db, req, "admin.settings.update", `registration_open=${b.registration_open}`);
    res.json({ registration_open: registrationOpen(db) });
  });

  r.get("/stats", (_req, res) =>
    res.json(
      db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM users) users,
                  (SELECT COUNT(*) FROM users WHERE is_admin=1) admins,
                  (SELECT COUNT(*) FROM users WHERE disabled=1) disabled,
                  (SELECT COUNT(*) FROM workspaces) workspaces,
                  (SELECT COUNT(*) FROM requests) requests`,
        )
        .get(),
    ),
  );

  r.get("/users", (req, res) => {
    const { q, limit, offset } = z
      .object({
        q: z.string().max(100).default(""),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const where =
      "(?='' OR instr(lower(username),lower(?))>0 OR instr(lower(name),lower(?))>0)";
    res.json({
      total: db
        .prepare(`SELECT COUNT(*) n FROM users WHERE ${where}`)
        .get(q, q, q).n,
      users: withAvatar(
        db
        .prepare(
          `SELECT id,username,name,avatar_v,is_admin,disabled,created_at,
                  (SELECT COUNT(*) FROM workspaces w WHERE w.owner_id=users.id) owned_workspaces,
                  (SELECT COUNT(*) FROM workspace_members m WHERE m.user_id=users.id) workspaces
           FROM users WHERE ${where}
           ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(q, q, q, limit, offset),
      ).map((u) => ({ ...u, is_admin: !!u.is_admin, disabled: !!u.disabled })),
    });
  });

  r.post("/users", (req, res) => {
    const b = z
      .object({
        username: usernameSchema,
        password,
        name: name.optional(),
        is_admin: bool.default(false),
      })
      .parse(req.body);
    if (usernameTaken(b.username))
      throw new HttpError(409, "Username already taken");
    const id = uid();
    db.prepare(
      "INSERT INTO users(id,username,name,password_hash,is_admin) VALUES(?,?,?,?,?)",
    ).run(
      id,
      b.username,
      b.name || b.username,
      bcrypt.hashSync(b.password, 11),
      b.is_admin ? 1 : 0,
    );
    audit(db, req, "admin.user.create", b.username);
    res.status(201).json({ id, username: b.username });
  });

  r.patch("/users/:id", (req, res) => {
    const b = z
      .object({
        username: usernameSchema.optional(),
        name: name.optional(),
        is_admin: bool.optional(),
        disabled: bool.optional(),
      })
      .parse(req.body);
    const u = getUser(req.params.id);
    // An admin can't lock themselves out; another admin has to do it.
    if (u.id === req.user.id && (b.is_admin === false || b.disabled === true))
      throw new HttpError(
        400,
        "You can't remove your own admin access or disable your own account",
      );
    if (b.username && usernameTaken(b.username, u.id))
      throw new HttpError(409, "Username already taken");
    const next = {
      username: b.username ?? u.username,
      name: b.name ?? u.name,
      is_admin: b.is_admin === undefined ? u.is_admin : b.is_admin ? 1 : 0,
      disabled: b.disabled === undefined ? u.disabled : b.disabled ? 1 : 0,
    };
    // Disabling revokes sessions now, so re-enabling can't resurrect an old token.
    const revoke = next.disabled && !u.disabled ? 1 : 0;
    db.prepare(
      "UPDATE users SET username=?,name=?,is_admin=?,disabled=?,token_version=token_version+? WHERE id=?",
    ).run(
      next.username,
      next.name,
      next.is_admin,
      next.disabled,
      revoke,
      u.id,
    );
    const changed = Object.keys(b)
      .map((k) => `${k}=${b[k]}`)
      .join(",");
    audit(db, req, "admin.user.update", `${u.username}:${changed}`);
    res.json({ ok: true });
  });

  // Sets a new password and signs the user out everywhere.
  r.post("/users/:id/password", (req, res) => {
    const b = z.object({ password }).parse(req.body);
    const u = getUser(req.params.id);
    db.prepare(
      "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
    ).run(bcrypt.hashSync(b.password, 11), u.id);
    audit(db, req, "admin.user.password_reset", u.username);
    // Resetting your own password must not sign you out of the panel.
    if (u.id === req.user.id) {
      const fresh = userRow(u.id);
      setCookie(res, fresh);
      return res.json({ ok: true, token: signToken(fresh) });
    }
    res.json({ ok: true });
  });

  r.delete("/users/:id", (req, res) => {
    const u = getUser(req.params.id);
    if (u.id === req.user.id)
      throw new HttpError(400, "You can't delete your own account");
    const owned = db
      .prepare("SELECT COUNT(*) n FROM workspaces WHERE owner_id=?")
      .get(u.id).n;
    if (owned)
      throw new HttpError(
        409,
        `${u.username} owns ${owned} workspace${owned > 1 ? "s" : ""}. Delete or reassign them first`,
      );
    audit(db, req, "admin.user.delete", u.username);
    db.prepare("DELETE FROM users WHERE id=?").run(u.id);
    res.json({ ok: true });
  });

  r.get("/workspaces", (req, res) => {
    const { q } = z
      .object({ q: z.string().max(100).default("") })
      .parse(req.query);
    res.json(
      db
        .prepare(
          `SELECT w.id,w.name,w.created_at,u.username owner,
                  (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id=w.id) members,
                  (SELECT COUNT(*) FROM requests rq WHERE rq.workspace_id=w.id) requests
           FROM workspaces w JOIN users u ON u.id=w.owner_id
           WHERE ?='' OR instr(lower(w.name),lower(?))>0 OR instr(lower(u.username),lower(?))>0
           ORDER BY w.created_at DESC, w.rowid DESC LIMIT 500`,
        )
        .all(q, q, q),
    );
  });
  r.delete("/workspaces/:id", (req, res) => {
    const w = db
      .prepare("SELECT id,name FROM workspaces WHERE id=?")
      .get(req.params.id);
    if (!w) throw new HttpError(404, "Workspace not found");
    audit(db, req, "admin.workspace.delete", w.name);
    db.prepare("DELETE FROM workspaces WHERE id=?").run(w.id);
    res.json({ ok: true });
  });

  // Platform-level actions (not tied to a workspace), newest first.
  r.get("/audit", (_req, res) =>
    res.json(
      db
        .prepare(
          `SELECT a.id,a.action,a.target,a.created_at,u.username "user"
           FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
           WHERE a.action LIKE 'admin.%' ORDER BY a.id DESC LIMIT 200`,
        )
        .all(),
    ),
  );
  return r;
}
