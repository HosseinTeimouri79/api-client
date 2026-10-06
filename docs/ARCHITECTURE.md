# Architecture

## Stack

| Layer         | Choice                                                      | Why                                                                                                                                                 |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend       | Node 22 + Express 5-style routers, zod validation           | small, well understood, easy to extend                                                                                                              |
| DB            | SQLite (`node:sqlite`, WAL, FK on) + versioned migrations   | zero ops, single file, no native build; the data layer is isolated in `src/db` so Postgres is a contained swap (ADR-1)                              |
| Auth          | bcrypt + JWT in httpOnly/SameSite=Strict cookie (or Bearer) | CSRF-resistant (custom header required for cookie auth)                                                                                             |
| Script engine | QuickJS compiled to WASM (`quickjs-emscripten`)             | real sandbox: no fs/net/process, CPU + memory limits (ADR-2)                                                                                        |
| Frontend      | Vanilla ES modules, no build step                           | no toolchain to maintain; safe DOM building (no `innerHTML` for user data). Components are isolated modules (`editors.js`, `response.js`, `app.js`) |

## Layout

```
src/
  app.js server.js config.js
  db/            index.js (open+migrate)  migrations.js (append-only)
  middleware/    auth.js  (authenticate, csrfGuard, requireWorkspace, audit)
  routes/        auth.js  workspaces.js (members, environments, audit)  content.js (tree, collections, requests, run, history)
  services/      permissions.js variables.js executor.js scriptEngine.js runner.js ssrf.js
public/          index.html style.css js/{app,api,editors,response,util}.js
tests/           unit.test.js api.test.js e2e.test.js
```

## Data model

`users` · `workspaces`(variables) · `workspace_members(role)` · `collections`(parent_id tree, variables, auth, pre/post script) · `requests`(method,url,params,headers,body,auth,variables,scripts) · `environments` · `history`(per user) · `audit_log`.
Collections carry variables/auth/scripts already, so **auth inheritance, collection scripts and collection variables work today** and tests/mock/etc. can be added as new columns/tables via migrations.

## Request pipeline (`services/runner.js`)

1. Load scopes. 2. Run pre-scripts (collection root→leaf, then request). 3. Resolve `{{vars}}` — precedence **runtime > request > collection(nearest) > environment > workspace**. 4. Build request (params, auth incl. inherited, body modes). 5. Execute (manual redirects, SSRF check on every hop and every connected IP). 6. Run post-scripts + tests. 7. Persist environment changes **only if the caller may write**. 8. Record history (unresolved request, never resolved secrets).
   Every step appends a structured log (`ts, level, message, context`) returned to the Console.

## Authorization

Roles `owner > admin > editor > viewer`; `services/permissions.js` is the single permission table. `requireWorkspace(db, perm)` loads the membership from the DB per request (never trusts the client) and returns 404 to non-members. Rules: admins can't grant admin or touch peers/owner; owner is immutable; no self role change; members can leave. Viewers can _run_ but never mutate (no env persistence either).

## Security notes

- **SSRF**: private/loopback/link-local/metadata ranges blocked; check on DNS-resolved IP (anti-rebinding via `lookup` hook), IP literals validated explicitly, redirects re-checked, credentials dropped on cross-origin redirect. Off-switch `ALLOW_PRIVATE_TARGETS` (default off).
- **Scripts**: QuickJS WASM, 1.5 s CPU budget, 32 MB memory, receive/return JSON only.
- **XSS**: DOM built with `textContent`; strict CSP (no inline scripts); HTML preview in `<iframe sandbox="" srcdoc>` (no scripts, opaque origin).
- **CSRF**: SameSite=Strict + required `X-Requested-With` for cookie-authenticated writes. **Injection**: parameterized SQL only; zod on every input. Login/register rate-limited.
- Known limits: secrets in environments are stored in plaintext in SQLite (use disk encryption; per-secret encryption is on the roadmap); JWTs are stateless (no server-side revocation yet).

## Scaling & performance

Tree endpoint returns names only (no bodies/scripts; collections carry just `has_pre`/`has_post` booleans, and `GET /collections/:id/scripts` returns the inherited script chain on demand); request details load lazily on open; collapsed branches are not rendered; search is debounced; history capped at 200 rows per query. For very large trees, swap `renderTree` for a windowed list. To scale out: Postgres + shared session secret; the app is otherwise stateless.

## Roadmap hooks

WebSocket/GraphQL/gRPC → add a `protocol` column on `requests` + a new executor next to `executor.js`. Tests/runner → `runner.js` already returns `tests`; add a collection-runner route. Mock server, OpenAPI import/export, monitoring/scheduling → new routes/services reading the same tables. Share-by-link → `share_links` table + a read-only middleware.

## ADRs

- **ADR-1 SQLite first.** Chosen for zero-ops team deployments. Consequence: single-writer; mitigated by WAL. Revisit at >~50 concurrent writers.
- **ADR-2 QuickJS-WASM over `vm`/`isolated-vm`.** Node `vm` is not a security boundary; `isolated-vm` needs native builds. QuickJS gives hard limits with no native deps at some perf cost.
- **ADR-3 Server-side execution.** Requests run from the backend (no CORS, history/logging, consistent scripting) at the price of SSRF risk, handled above. A browser-agent mode for localhost APIs is a possible future add-on.
- **ADR-4 No frontend build.** Fewer moving parts; migrate to a bundler/TypeScript when the UI outgrows modules.
