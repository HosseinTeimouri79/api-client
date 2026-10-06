# API Client

A self-hostable, team-oriented API client (Postman-style): collections & sub-collections, requests with all common body types, environments/variables, pre/post-request scripts (sandboxed), response viewer, console, history, workspaces with role-based sharing.

## Quick start (Docker)

```bash
cp .env.example .env && sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build
open http://localhost:3000        # register the first user, create a workspace
```

Data lives in the `apiclient-data` volume (`/data/app.db`). Back up that volume.

## Local development

```bash
npm install
npm run dev            # http://localhost:3000, DB in ./data/app.db, random JWT secret per start
ALLOW_PRIVATE_TARGETS=true npm run dev   # to call localhost APIs from the app
npm test               # unit + integration + E2E (E2E needs Chromium; set CHROME_PATH or it is skipped)
```

Requires Node ≥ 22.13 (built-in `node:sqlite`).

## Configuration

| Variable                                                          | Default              | Notes                                                        |
| ----------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `JWT_SECRET`                                                      | random (dev)         | **required** in production                                   |
| `PORT`                                                            | 3000                 |                                                              |
| `DB_PATH`                                                         | `./data/app.db`      | `/data/app.db` in Docker                                     |
| `COOKIE_SECURE`                                                   | true in prod         | set `false` only for plain-HTTP local use                    |
| `TRUST_PROXY`                                                     | false                | `true` behind a reverse proxy (rate limiting uses client IP) |
| `ALLOW_PRIVATE_TARGETS`                                           | false                | SSRF guard. Enable only to call internal/localhost APIs      |
| `SCRIPT_TIMEOUT_MS` / `REQUEST_TIMEOUT_MS` / `MAX_RESPONSE_BYTES` | 1500 / 30000 / 10 MB |                                                              |

## Database & migrations

Migrations run automatically at start (`src/db/migrations.js`, append-only, transactional, tracked in `_migrations`). To change the schema add a new entry with the next `id`; never edit applied ones.

## Production deployment

Run behind HTTPS (nginx/Traefik/Caddy), set `COOKIE_SECURE=true`, `TRUST_PROXY=true`, a strong `JWT_SECRET`, keep `ALLOW_PRIVATE_TARGETS=false` on public deployments. Container runs as non-root with a read-only root FS. Health: `GET /healthz`.

## Scripting

```js
// pre-request
pm.variables.set("timestamp", Date.now());
pm.request.headers.add("X-Trace", "1");
// post-request
const data = response.json();
if (data.token) pm.environment.set("token", data.token);
test("Status should be 200", () => expect(response.status).toBe(200));
```

Collection-level pre/post scripts run for every request inside the collection and its sub-collections (outermost first, then the request's own). In the request editor the **Pre-request / Post-request** tabs show a badge and an expandable, read-only reference to each inherited script (with a shortcut to edit it); collections that define scripts are marked with a `</>` icon in the tree.

Available: `pm.variables / environment / collectionVariables` (`get,set,unset,has`), `response` (`status, json(), text(), headers`), `test`, `expect(...).toBe/toEqual/toContain/toBeTruthy/…/not`, `console.*`. Scripts run in a WASM sandbox (no network, filesystem, `require`). `pm.environment.set` persists to the selected environment for Editors+; Viewers' runs never persist.

## Environments import / export

**Environments & variables** has its own Import (Postman or Hoppscotch environment `.json`, several files at once) and Export (Postman v2.1, Hoppscotch, or all environments as one Hoppscotch file). Unsaved edits to the selected environment are saved before exporting. The generic **Import / Export** dialog still handles collections.

## Permissions

| Role   | Run | Edit requests/collections/scripts/envs | Manage members & workspace            | Delete workspace |
| ------ | --- | -------------------------------------- | ------------------------------------- | ---------------- |
| Viewer | ✓   |                                        |                                       |                  |
| Editor | ✓   | ✓                                      |                                       |                  |
| Admin  | ✓   | ✓                                      | ✓ (cannot grant admin / change owner) |                  |
| Owner  | ✓   | ✓                                      | ✓                                     | ✓                |

## Shortcuts

`Ctrl/⌘+Enter` send · `Ctrl/⌘+S` save · `Ctrl/⌘+T` new tab · ``Ctrl/⌘+` `` toggle console.

## Status vs. spec

Done: auth, workspaces, RBAC, collections tree (+drag & drop, duplicate, sort), all methods/body types, auth (bearer/basic/API key, inheritance), environments + 5-level variables, pre/post scripts (request + collection), response viewer (JSON tree/search/raw, HTML sandboxed preview, headers, binary), console, history, audit log, dark/light, tests, Docker.
Not yet: file upload in multipart, invitation of not-yet-registered users, share-by-link, XML pretty-printing, TypeScript types. See `docs/ARCHITECTURE.md` for the roadmap hooks.
