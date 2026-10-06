import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { uid } from "../db/index.js";
import { HttpError, signToken, authenticate } from "../middleware/auth.js";
import { config } from "../config.js";

const cred = z.object({
  email: z
    .string()
    .email()
    .max(200)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(200),
});
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
    const { email, password } = cred
      .extend({ name: z.string().min(1).max(100) })
      .parse(req.body);
    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
      throw new HttpError(409, "Email already registered");
    const user = { id: uid(), email, name: req.body.name };
    db.prepare(
      "INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)",
    ).run(user.id, email, user.name, bcrypt.hashSync(password, 11));
    setCookie(res, user);
    res.status(201).json({ user, token: signToken(user) });
  });
  r.post("/login", limiter, (req, res) => {
    const { email, password } = cred.parse(req.body);
    const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    const ok = bcrypt.compareSync(
      password,
      u?.password_hash ??
        "$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali",
    ); // constant-ish time
    if (!u || !ok) throw new HttpError(401, "Invalid email or password");
    const user = { id: u.id, email: u.email, name: u.name };
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
