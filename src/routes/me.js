import express, { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { HttpError, publicUser, setCookie } from "../middleware/auth.js";
import { usernameSchema } from "./auth.js";
import { SettingsSchema } from "../services/userSettings.js";
import { LOCALES, LEGACY, normalizeLocale } from "../services/locales.js";

const MAX_AVATAR = 400 * 1024; // the UI re-encodes to 256px, so real files are ~10-40 KB

// Decide the type from the bytes, never from the client's Content-Type. SVG is deliberately not accepted (script injection).
const sniff = (b) =>
  b.length > 12 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG"
    ? "image/png"
    : b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
      ? "image/jpeg"
      : b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP"
        ? "image/webp"
        : null;

// Self-service profile for the signed-in user (mounted at /api/me).
export function meRouter(db) {
  const r = Router();
  const me = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);

  r.patch("/", (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        username: usernameSchema.optional(),
        locale: z.enum([...LOCALES, ...Object.keys(LEGACY)]).transform(normalizeLocale).optional(),
        settings: SettingsSchema.optional(),
      })
      .parse(req.body);
    const u = me(req.user.id);
    if (
      b.username &&
      db.prepare("SELECT 1 FROM users WHERE username=? AND id<>?").get(b.username, u.id)
    )
      throw new HttpError(409, "Username already taken");
    db.prepare("UPDATE users SET name=?,username=?,locale=?,settings=? WHERE id=?").run(
      b.name ?? u.name,
      b.username ?? u.username,
      b.locale ?? u.locale,
      b.settings ? JSON.stringify(b.settings) : u.settings,
      u.id,
    );
    res.json({ user: publicUser(me(u.id)) });
  });

  r.put(
    "/avatar",
    express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MAX_AVATAR }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(415, "Send a PNG, JPEG or WebP image");
      if (!sniff(req.body)) throw new HttpError(415, "Not a valid PNG, JPEG or WebP image");
      db.prepare("UPDATE users SET avatar=?,avatar_v=? WHERE id=?").run(
        req.body,
        Date.now(),
        req.user.id,
      );
      res.json({ user: publicUser(me(req.user.id)) });
    },
  );
  r.delete("/avatar", (req, res) => {
    db.prepare("UPDATE users SET avatar=NULL,avatar_v=NULL WHERE id=?").run(req.user.id);
    res.json({ user: publicUser(me(req.user.id)) });
  });

  // Changing your own password needs the current one, signs out other sessions, and keeps this one.
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isProd ? 10 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });
  r.post("/password", limiter, (req, res) => {
    const b = z
      .object({
        current_password: z.string().min(1).max(200),
        new_password: z.string().min(8).max(200),
      })
      .parse(req.body);
    const u = me(req.user.id);
    if (!bcrypt.compareSync(b.current_password, u.password_hash))
      throw new HttpError(400, "Current password is incorrect");
    db.prepare(
      "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
    ).run(bcrypt.hashSync(b.new_password, 11), u.id);
    const fresh = me(u.id);
    setCookie(res, fresh);
    res.json({ ok: true });
  });
  return r;
}

// Avatars are visible to every signed-in user (they already see each other in member lists).
export function usersRouter(db) {
  const r = Router();
  r.get("/:id/avatar", (req, res) => {
    const u = db.prepare("SELECT avatar FROM users WHERE id=?").get(req.params.id);
    if (!u?.avatar) throw new HttpError(404, "No avatar");
    res.set("Cache-Control", "private, max-age=31536000, immutable"); // URL carries ?v=<upload time>
    res.type(sniff(Buffer.from(u.avatar)) ?? "application/octet-stream").send(Buffer.from(u.avatar));
  });
  return r;
}
