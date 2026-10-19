import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate, csrfGuard, HttpError } from "./middleware/auth.js";
import { version, config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspaces.js";
import { contentRouter } from "./routes/content.js";
import { meRouter, usersRouter } from "./routes/me.js";
import { adminRouter } from "./routes/admin.js";
import { interopRouter } from "./routes/interop.js";
import { sessionsRouter } from "./routes/sessions.js";
import { protocolToolsRouter } from "./routes/protocolTools.js";
import { agentDownloadsRouter, agentInfoRouter } from "./routes/agent.js";
import { PendingRuns } from "./services/pendingRuns.js";

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "true");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Local mode: the page talks to the Local Agent on the user's own computer (loopback only)
          connectSrc: ["'self'", ...(config.localAgent ? ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"] : [])],
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
  // A Local-mode result carries the whole response (base64 when binary), so it may be as large as the response limit
  // allows; it is parsed only once the caller is signed in (below).
  const RESULT = /^\/workspaces\/[^/]+\/(run|graphql\/introspect)\/[^/]+\/complete$/;
  const resultLimit = config.maxResponseBytesLimit ? Math.ceil(config.maxResponseBytesLimit * 1.4) + 1024 ** 2 : "1gb";
  const json = express.json({ limit: "8mb" });
  app.use((req, res, next) => (req.path.startsWith("/api/") && RESULT.test(req.path.slice(4)) ? next() : json(req, res, next)));
  app.get("/healthz", (_req, res) => res.json({ ok: true, version }));
  app.use("/agent", agentDownloadsRouter());
  const api = express.Router();
  api.use("/auth", authRouter(db));
  api.use(authenticate(db), csrfGuard);
  api.use(RESULT, express.json({ limit: resultLimit }));
  api.use("/me", meRouter(db));
  api.use("/users", usersRouter(db));
  api.use("/admin", adminRouter(db));
  api.use("/workspaces", workspaceRouter(db));
  const pending = new PendingRuns(); // Local-mode runs waiting for the agent's answer
  app.locals.pendingRuns = pending;
  api.use("/agent", agentInfoRouter());
  api.use("/workspaces/:wid", contentRouter(db, pending));
  api.use("/workspaces/:wid", interopRouter(db));
  api.use("/workspaces/:wid", protocolToolsRouter(db, pending));
  const live = sessionsRouter(db);
  api.use("/workspaces/:wid", live);
  app.locals.sessions = live.sessions; // closed with the server (tests, shutdown)
  api.use((_req, _res, next) => next(new HttpError(404, "Not found")));
  app.use("/api", api);
  // The React UI is built to /dist (`npm run build`); unknown non-API paths fall back to the SPA shell.
  const dist = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  );
  // dist/agent-ui/ is the Local Agent's own page, built into the agent: not served from here
  app.use("/agent-ui", (_req, _res, next) => next(new HttpError(404, "Not found")));
  app.use(express.static(dist));
  app.get(/^\/(?!api\/|healthz|agent\/).*/, (_req, res, next) =>
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
