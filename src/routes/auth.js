import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { uid } from "../db/index.js";
import { HttpError, signToken, authenticate } from "../middleware/auth.js";
import { config } from "../config.js";

const username = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, "Only letters, digits, . _ - are allowed")
  .transform((s) => s.toLowerCase());
const setCookie = (res, user) =>
  res.cookie("token", signToken(user), {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProd && process.env.COOKIE_SECURE !== "false",
    maxAge: 7 * 864e5,
  });

export function authRouter(db) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isProd ? 30 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });
  r.post("/register", limiter, (req, res) => {
    const b = z
      .object({
        username,
        password: z.string().min(8).max(200),
        name: z.string().trim().max(100).optional(),
      })
      .parse(req.body);
    if (db.prepare("SELECT 1 FROM users WHERE username=?").get(b.username))
      throw new HttpError(409, "Username already taken");
    const user = { id: uid(), username: b.username, name: b.name || b.username };
    db.prepare(
      "INSERT INTO users(id,username,name,password_hash) VALUES(?,?,?,?)",
    ).run(user.id, user.username, user.name, bcrypt.hashSync(b.password, 11));
    setCookie(res, user);
    res.status(201).json({ user, token: signToken(user) });
  });
  r.post("/login", limiter, (req, res) => {
    const b = z
      .object({
        username: z.string().trim().min(1).max(200).transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const u = db.prepare("SELECT * FROM users WHERE username=?").get(b.username);
    const ok = bcrypt.compareSync(
      b.password,
      u?.password_hash ??
        "$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali",
    ); // constant-ish time
    if (!u || !ok) throw new HttpError(401, "Invalid username or password");
    const user = { id: u.id, username: u.username, name: u.name };
    setCookie(res, user);
    res.json({ user, token: signToken(user) });
  });
  r.post("/logout", (_req, res) => {
    res.clearCookie("token");
    res.json({ ok: true });
  });
  r.get("/me", authenticate(db), (req, res) => res.json({ user: req.user }));
  return r;
}
