import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { can } from "../services/permissions.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const signToken = (user) =>
  jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: "7d" });

// Token via httpOnly cookie (browser) or Bearer header (API clients).
export function authenticate(db) {
  return (req, _res, next) => {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : req.cookies?.token;
    if (!token) return next(new HttpError(401, "Authentication required"));
    try {
      const { sub } = jwt.verify(token, config.jwtSecret);
      const user = db
        .prepare("SELECT id,username,name FROM users WHERE id=?")
        .get(sub);
      if (!user) throw new Error();
      req.user = user;
      req.usingCookie = !h;
      next();
    } catch {
      next(new HttpError(401, "Invalid or expired token"));
    }
  };
}
// CSRF: cookie-authenticated mutating requests need a custom header (cross-site forms/simple requests can't set it).
export const csrfGuard = (req, _res, next) => {
  if (
    req.usingCookie &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers["x-requested-with"] !== "api-client"
  )
    return next(new HttpError(403, "CSRF check failed"));
  next();
};
// Resolves membership for :wid and enforces permission. Never trusts client-provided role.
export const requireWorkspace = (db, perm) => (req, _res, next) => {
  const m = db
    .prepare(
      "SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
    )
    .get(req.params.wid, req.user.id);
  if (!m) return next(new HttpError(404, "Workspace not found")); // don't leak existence
  if (!can(m.role, perm))
    return next(new HttpError(403, "Insufficient permissions"));
  req.role = m.role;
  req.wid = req.params.wid;
  next();
};
export const audit = (db, req, action, target) =>
  db
    .prepare(
      "INSERT INTO audit_log(workspace_id,user_id,action,target) VALUES(?,?,?,?)",
    )
    .run(req.wid ?? null, req.user?.id ?? null, action, target ?? null);
