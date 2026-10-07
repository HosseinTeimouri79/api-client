import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate, csrfGuard, HttpError } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspaces.js";
import { contentRouter } from "./routes/content.js";
import { interopRouter } from "./routes/interop.js";

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "true");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null, // <-- این خط
        },
      },
      strictTransportSecurity: false, // <-- و این
      crossOriginOpenerPolicy: false, // اگر هنوز هشدار COOP را نمی‌خواهید
      originAgentCluster: false,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "8mb" }));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  const api = express.Router();
  api.use("/auth", authRouter(db));
  api.use(authenticate(db), csrfGuard);
  api.use("/workspaces", workspaceRouter(db));
  api.use("/workspaces/:wid", contentRouter(db));
  api.use("/workspaces/:wid", interopRouter(db));
  api.use((_req, _res, next) => next(new HttpError(404, "Not found")));
  app.use("/api", api);
  // The React UI is built to /dist (`npm run build`); unknown non-API paths fall back to the SPA shell.
  const dist = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  );
  app.use(express.static(dist));
  app.get(/^\/(?!api\/|healthz).*/, (_req, res, next) =>
    res.sendFile(path.join(dist, "index.html"), (e) => e && next()),
  );
  // Central error handler: never crashes the process, never leaks internals.
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError)
      return res.status(400).json({
        error: "Validation failed",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (err?.type === "entity.too.large")
      return res.status(413).json({ error: "Payload too large" });
    if (err?.type === "entity.parse.failed")
      return res.status(400).json({ error: "Malformed JSON" });
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}
