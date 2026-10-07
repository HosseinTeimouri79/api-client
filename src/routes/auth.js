import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { uid } from "../db/index.js";
import { HttpError, signToken, authenticate, publicUser, setCookie } from "../middleware/auth.js";
import { config } from "../config.js";
import { registrationOpen } from "../services/settings.js";

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, "Only letters, digits, . _ - are allowed")
  .transform((s) => s.toLowerCase());

export function authRouter(db) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isProd ? 30 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });
  // Public: lets the sign-in screen hide "Create account" when only admins can add users.
  r.get("/config", (_req, res) =>
    res.json({
      registration:
        registrationOpen(db) || !db.prepare("SELECT 1 FROM users LIMIT 1").get(),
    }),
  );
  r.post("/register", limiter, (req, res) => {
    const b = z
      .object({
        username: usernameSchema,
        password: z.string().min(8).max(200),
        name: z.string().trim().max(100).optional(),
      })
      .parse(req.body);
    // The very first account bootstraps the admin panel and is always allowed.
    const first = !db.prepare("SELECT 1 FROM users LIMIT 1").get();
    if (!first && !registrationOpen(db))
      throw new HttpError(
        403,
        "Registration is disabled. Ask an administrator to create your account",
      );
    if (db.prepare("SELECT 1 FROM users WHERE username=?").get(b.username))
      throw new HttpError(409, "Username already taken");
    const user = { id: uid(), username: b.username, name: b.name || b.username, is_admin: first };
    db.prepare(
      "INSERT INTO users(id,username,name,password_hash,is_admin) VALUES(?,?,?,?,?)",
    ).run(user.id, user.username, user.name, bcrypt.hashSync(b.password, 11), first ? 1 : 0);
    setCookie(res, user);
    res.status(201).json({ user: publicUser(user), token: signToken(user) });
  });
  r.post("/login", limiter, (req, res) => {
    const b = z
      .object({
        username: z.string().trim().min(1).max(200).transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const u = db
      .prepare(
        "SELECT id,username,name,is_admin,disabled,token_version,avatar_v,locale,settings,password_hash FROM users WHERE username=?",
      )
      .get(b.username);
    const ok = bcrypt.compareSync(
      b.password,
      u?.password_hash ??
        "$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali",
    ); // constant-ish time
    if (!u || !ok) throw new HttpError(401, "Invalid username or password");
    if (u.disabled) throw new HttpError(403, "This account is disabled");
    const user = { ...publicUser(u), token_version: u.token_version };
    setCookie(res, user);
    res.json({ user: publicUser(user), token: signToken(user) });
  });
  r.post("/logout", (_req, res) => {
    res.clearCookie("token");
    res.json({ ok: true });
  });
  r.get("/me", authenticate(db), (req, res) => res.json({ user: req.user }));
  return r;
}
