# API Client

A self-hostable, team-oriented API client (Postman-style): collections & sub-collections, requests with all common body types, environments/variables, pre/post-request scripts (sandboxed), response viewer, console, history, workspaces with role-based sharing.

## Quick start (Docker)

```bash
cp .env.example .env && sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build
open http://localhost:3000        # create an account (username + password), create a workspace
```

Data lives in the `apiclient-data` volume (`/data/app.db`). Back up that volume.

## Local development

```bash
npm install
npm run build          # builds the React UI (web/) into dist/
npm run dev            # API + built UI on http://localhost:3000, DB in ./data/app.db, random JWT secret per start
npm run dev:web        # (second terminal) UI with hot reload on http://localhost:5173, proxies /api to :3000
ALLOW_PRIVATE_TARGETS=true npm run dev   # to call localhost APIs from the app
npm test               # builds the UI, then unit + integration + E2E (E2E needs Chromium; set CHROME_PATH or it is skipped)
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

## Accounts

Sign in with a **username and password** (no email). Usernames are 3–32 characters (`A–Z a–z 0–9 . _ -`), case-insensitive. On upgrade, existing accounts keep their password and get a username from the part of their email before the `@` (made unique with a number if needed).

To add people to a workspace open **Members**: the picker lists every user that is not a member yet, searchable by name or username as you type, so you can select several at once and give them a role.

## Scripting

Scripts run in a WASM sandbox (no network, filesystem or `process`). Postman scripts work as-is for the common API.

### Pre-request: change the request before it is sent

```js
const body = JSON.parse(pm.request.body.raw);                 // the body as typed in the Body tab
const sum  = CryptoJS.SHA1(JSON.stringify(body.params) + pm.variables.get("api_key"));
postman.setGlobalVariable("checksum", sum);                    // or pm.globals.set(...)
pm.request.body.raw = { checksum: "{{checksum}}", params: body.params, uid: body.uid }; // objects are stringified
pm.request.headers.upsert("X-Trace", Date.now());
pm.request.params.add("ts", new Date().toISOString());
pm.request.url = pm.request.url + "/v2";                       // pm.request.method = "POST" works too
```

`pm.request`: `url`, `method`, `headers` / `params` (`add upsert remove get has toObject all clear`), `body` (`raw`, `mode`, `urlencoded`, `formdata`, `update()`). `{{variables}}` are resolved **after** the script, so the value you just set is used. The **Request** tab of the response shows what was actually sent (with a badge when a script changed it) and the Console logs `Request modified by pre-request script`.

### Post-request: change what the UI receives, test, store values

```js
const data = pm.response.json();
if (data.token) pm.environment.set("token", data.token);
pm.response.setBody({ count: data.items.length, items: data.items }); // object or string
pm.response.setStatus(200, "OK");  pm.response.setHeader("X-Processed", "1");
pm.test("Status is 200", () => pm.response.to.have.status(200));
```

The response panel is marked **modified by script** when a post script changed it. Collection scripts run first (outermost → nearest), each seeing the previous one's result.

### Reference

`pm.variables / environment / globals / collectionVariables` (`get set unset has clear toObject`; `pm.variables.get` and `replaceIn` resolve every scope), `postman.setGlobalVariable / getGlobalVariable / setEnvironmentVariable …`, `pm.response` (`json() text() code status headers.get() responseTime`, `to.have.status/header/jsonBody`, `to.be.ok/success/error`), `pm.test`, `pm.expect` (jest `toBe toEqual …` **and** chai `to.equal .eql .include .have.property .be.a("string") …`), `CryptoJS` / `require("crypto-js")` (SHA1/256/MD5, HMAC, Base64, AES …), `btoa/atob`, `console.*`. Not supported: `pm.sendRequest` (network is blocked by design). `pm.environment.set` and `pm.globals.set` persist for Editors+ (globals are the workspace variables); Viewers' runs never persist.

In the editor, type `pm.` for completions and use **Snippets** for ready-made examples.

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

Done: user settings (profile photo, name/username, password), admin panel (user management, password reset, disable, workspaces, activity), username login, member picker (autocomplete), React UI with custom components (AutoComplete, Select, Menu, Modal, variable-aware inputs, code editor with completions), auth, workspaces, RBAC, collections tree (+drag & drop, duplicate, sort), all methods/body types, auth (bearer/basic/API key, inheritance), environments + 5-level variables, pre/post scripts (request + collection), scripts that rewrite the request and the response, response viewer (JSON tree/search/raw, HTML sandboxed preview, headers, sent-request view, binary), console, history, audit log, dark/light, tests, Docker.
Not yet: file upload in multipart, invitation of not-yet-registered users, share-by-link, XML pretty-printing, TypeScript types. See `docs/ARCHITECTURE.md` for the roadmap hooks.
