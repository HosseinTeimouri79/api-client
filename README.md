<div align="center">

<img src="api.png" alt="API Client logo" width="120" />

# API Client

**A self-hostable, team-oriented API client.**
Organize requests in collections, share them in workspaces, script them, turn them into code, and move your data
in and out with **Postman** and **Hoppscotch**.

Version **1.0.0** · [Changelog](CHANGELOG.md) · [License: Apache-2.0](LICENSE)

</div>

---

## Table of contents

1. [Why self-host it](#why-self-host-it)
2. [Features](#features)
3. [Quick start](#quick-start)
4. [Installation and setup](#installation-and-setup)
5. [Testing internal web services](#testing-internal-web-services)
6. [Local Agent (Server and Local mode)](#local-agent)
7. [Configuration](#configuration)
8. [Using the app](#using-the-app)
9. [Import and export (Postman and Hoppscotch)](#import-and-export-postman-and-hoppscotch)
10. [Scripting](#scripting)
11. [Code snippets](#code-snippets)
12. [Languages](#languages)
13. [Accounts, roles and administration](#accounts-roles-and-administration)
14. [HTTP API](#http-api)
15. [Architecture](#architecture)
16. [Security](#security)
17. [Testing](#testing)
18. [Versioning and releases](#versioning-and-releases)
19. [Roadmap](#roadmap)
20. [License and attribution](#license-and-attribution)

---

## Why self-host it

API Client runs **entirely on your own infrastructure**. It is a single Node.js process with an embedded database, so you can run it:

- **inside your organization**, on a company server, a VM, Kubernetes or a Docker host, shared by the whole team;
- **on your own computer**, for personal or local use, with nothing leaving your machine.

What that means in practice:

- **Test internal web services without a cloud platform.** Requests are sent from the machine that runs the app, so it can reach
  services on your private network, staging environments and `localhost` directly (see
  [Testing internal web services](#testing-internal-web-services)). You do not need to sign up for, or send your collections and
  secrets to, Postman or any other hosted service.
- **Your data stays with you.** Collections, environments, secrets, history and accounts live in one SQLite file that you
  control and back up. There is no vendor account and no cloud sync.
- **No limits imposed by the app.** There are no seats, plans, paywalled features or caps on workspaces, collections, requests,
  environments, history or **team members** — add as many people as your server can handle. The only limits are your own
  hardware and the request limits you configure.
- **Free and open source.** Free to use, for personal and commercial purposes, under the [Apache License 2.0](#license-and-attribution)
  (keep the license and credit the author and source).
- **Compatible with the tools you already use.** Import and export Postman and Hoppscotch collections and environments, so
  moving in or out is never a lock-in (see [Import and export](#import-and-export-postman-and-hoppscotch)).

---

## Features

**Requests and organization**

- Workspaces shared with role-based access (owner, admin, editor, viewer), member picker, audit log.
- Collections and sub-collections with drag and drop, duplicate, sort, move to root and **descriptions**.
- **HTTP** with every method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE, CONNECT) and body type: JSON, text, raw,
  form URL-encoded, multipart (text fields). `TRACE` and `CONNECT` are sent without a body. For `CONNECT` the URL is the proxy
  and the tunnel target is the URL path (`https://proxy:3128/example.com:443`); the proxy's reply is shown and the tunnel is closed.
- **Nine protocols** in one tool: HTTP, WebSocket, gRPC, GraphQL, SSE, TCP, UDP, MQTT and AMQP (see [Protocols](#protocols)); each
  request has a protocol, is saved in collections like any other and shares variables, environments, auth and the address checks.
- Query params, headers with autocomplete, **Bearer / Basic / API-key** auth with inheritance from collections.
- **Environments** and variables with five scopes: runtime > request > collection > environment > workspace.
- Response viewer: JSON tree with search, raw, sandboxed HTML preview, headers, "what was actually sent", binary download.
- Console, per-user history, tabs, keyboard shortcuts, dark and light themes.

**Scripting**

- Pre-request and post-request scripts at request and collection level, run in a **WASM sandbox** (QuickJS).
- Postman-compatible `pm.*` API, tests and assertions (jest and chai style), CryptoJS.
- Scripts can rewrite the request before it is sent and the response before the UI shows it.

**Tooling**

- **Code snippets** in 35 language/library targets (cURL by default), generated from the request as currently edited.
- **Import and export of Postman and Hoppscotch** collections and environments.
- Per-user **app settings**: request timeout, maximum response size, layout, console, editor font and indentation,
  auto-close brackets and quotes, theme, language, app font, autosave.

**Teams and administration**

- Username and password accounts, profile photo and profile editing, password change.
- **Admin panel**: manage users (create, edit, reset password, disable, delete), workspaces, activity, and switch
  self-registration off so that only admins can create accounts.
- View-only members can still change a request to try it out; nothing they change can be saved.

**Interface**

- **15 languages** with a flag + name picker, and a fully mirrored layout for Arabic and Persian (RTL).

**Operations**

- Single Node.js process with an embedded SQLite database, versioned automatic migrations, health check, Docker image
  that runs as a non-root user with a read-only root filesystem.

---

## Quick start

### With Docker

```bash
cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build
```

Open <http://localhost:3000>, choose **Create account**, and register. **The first account becomes the administrator.**
Then create a workspace and start sending requests.

Data lives in the `apiclient-data` volume (`/data/app.db` inside the container). Back that volume up.

### Without Docker

```bash
npm install
npm run build        # builds the React UI (web/) into dist/
JWT_SECRET=$(openssl rand -hex 32) npm start
```

Requires **Node.js 22.13 or newer** (the app uses the built-in `node:sqlite`).

---

## Installation and setup

### Requirements

| Tool                | Needed for                         | Notes                                              |
| ------------------- | ---------------------------------- | -------------------------------------------------- |
| Node.js ≥ 22.13     | running and developing             | built-in SQLite, no native build step              |
| npm                 | installing dependencies            |                                                    |
| Docker + Compose    | the container deployment           | optional                                           |
| Chromium / Chrome   | the end-to-end tests               | optional; set `CHROME_PATH` or those tests are skipped |

### Docker (recommended for teams)

1. Copy the example environment file and set a strong secret:

   ```bash
   cp .env.example .env
   sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
   ```

2. Review `.env` (see [Configuration](#configuration)). Behind HTTPS set `COOKIE_SECURE=true`; behind a reverse proxy set
   `TRUST_PROXY=true`.
3. Start it: `docker compose up -d --build`.
4. Check it: `curl http://localhost:3000/healthz` returns `{"ok":true,"version":"1.0.0"}`.
5. Register the first account in the browser; it is the administrator. Optionally turn self-registration off in
   **Account menu → Admin panel → Settings** and create the other accounts yourself.

The container runs as the unprivileged `node` user with a read-only root filesystem; only `/data` is writable.
`docker-compose.yml` mounts the `apiclient-data` volume there.

**Upgrading:** pull the new sources, then `docker compose up -d --build`. Database migrations run automatically at start.
Back up the volume first (for example `docker run --rm -v apiclient-data:/data -v "$PWD":/backup alpine tar czf /backup/apiclient-data.tgz -C /data .`).

### Local development

```bash
npm install
npm run build        # build the UI once (also run by `npm test`)
npm run dev          # API + built UI on http://localhost:3000 with auto-restart; DB in ./data/app.db
npm run dev:web      # in a second terminal: UI with hot reload on http://localhost:5173 (proxies /api to :3000)
```

- A random `JWT_SECRET` is generated on every start in development, so you are signed out after a restart. Set
  `JWT_SECRET` in your shell to keep sessions.
- To call APIs running on your own machine (localhost, private IPs), start with `ALLOW_PRIVATE_TARGETS=true`. The
  server blocks private targets by default (see [Security](#security)).
- To become the administrator on an existing database, set `ADMIN_USERNAMES=<your username>`.

### Personal use on your own computer

Run it locally for yourself: `npm install && npm run build && npm start` (or `docker compose up -d --build`), open
<http://localhost:3000>, and create the first account (you are the administrator). Add `ALLOW_PRIVATE_TARGETS=true` so you can call
APIs on your own machine, and turn self-registration off in the admin panel if the app is reachable by others. Nothing is sent to any
third-party service.

### Behind a reverse proxy (production)

Run the app behind HTTPS (nginx, Traefik, Caddy). Set `COOKIE_SECURE=true`, `TRUST_PROXY=true`, a strong `JWT_SECRET`
and leave `ALLOW_PRIVATE_TARGETS=false` on public deployments. Example Caddy site:

```caddyfile
api.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Example nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 10m;
}
```

Health check endpoint: `GET /healthz` → `{"ok":true,"version":"<app version>"}`.

---

## Testing internal web services

Requests are sent **from the server that runs API Client**, not from your browser. That is what lets you test services that are
not on the public internet, with no tunnel and no cloud account:

- an API on `localhost` or on another port of the same machine;
- services on your company network or VPN (private IP ranges such as `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`, internal hostnames);
- staging and development environments, containers and Kubernetes services that the server can resolve.

**On a shared server, prefer [Local mode](#local-agent):** each user's requests to `localhost` and their own network are sent
by the Local Agent on their computer, and the server keeps refusing private targets.

**By default the app refuses private, loopback and link-local targets** (this is an SSRF protection, see [Security](#security)), so
on a deployment that is only used inside your organization, or on your own computer, enable them:

```bash
ALLOW_PRIVATE_TARGETS=true
```

(in `.env` for Docker, or in the environment of the process). Notes:

- The server must be able to reach the service you call: with Docker, use a host name the container can resolve (for example
  `host.docker.internal` for something running on the Docker host, or the name of another compose service on the same network).
- Turn this switch on **only for private installations**. On a deployment exposed to people you do not trust, leave it off so
  nobody can use the server to reach your internal network.
- Use environments and variables (`{{baseUrl}}`) to switch between local, staging and production targets, and share collections
  with your team in a workspace.

---

## Local Agent

Requests can be sent from two places, and every user picks one with the **Server / Local** switch in the header:

- **Server mode** (the default): the API Client server sends them, as described above. It reaches what the server can reach.
- **Local mode**: the **Local Agent**, a small program installed on the user's own computer, sends them. `localhost`, the
  user's LAN, VPN and anything else that computer can reach just work, even when the server is shared and keeps its SSRF
  protection on (`ALLOW_PRIVATE_TARGETS=false`).

Everything else is identical in both modes: variables, environments, inherited auth, pre-request and post-request scripts,
tests, history, the console and all nine protocols. Only the place the bytes come from changes.

### How it works

```
 Browser (API Client UI)                     API Client server                    User's computer
 ───────────────────────                     ─────────────────                    ───────────────
 lib/transport.js ── Server mode ─────────▶  POST /run → runner → network
        │
        └────────── Local mode ──────────▶  POST /run/prepare                    (pre-request scripts, variables,
                                             ◀── { runId, built request }          auth, the request is built)
               ── POST /v1/execute ──────────────────────────────────────────▶  Local Agent (127.0.0.1:47823)
               ◀── response / error ────────────────────────────────────────── → localhost, LAN, internet
                                             POST /run/:runId/complete  ──▶      (post-request scripts, tests,
                                             ◀── the same result as /run          saved variables, history)
```

- **One pipeline.** `server/services/runner.js` is split around the network call (`startRun` → `finish`). Server mode runs both
  halves in one request; Local mode runs the first half, lets the agent make the call, and finishes with what the agent got.
  The browser's `lib/transport.js` is the single layer the store talks to (`run`, `introspect`, `open`, `follow`, `act`,
  `close`), so switching modes never touches the rest of the app.
- **Live protocols** (WebSocket, gRPC streams, GraphQL subscriptions, SSE, TCP, UDP, MQTT, AMQP): the server resolves the
  variables and auth (`POST /sessions/prepare`), and the agent opens and holds the connection with the same drivers
  (`core/protocols`) and event log (`core/sessions.js`) as the server.
- **Switching while the app runs**: a request already on its way, and every open connection, stays with the mode it started
  in until it ends; new requests use the new mode. Nothing falls back silently: in Local mode a stopped agent is an error
  (it is shown in the response panel and the header turns red), never a request quietly sent from the server.
- **The agent going away**: an unanswered run is completed as a network error ("Local Agent is not reachable") and recorded
  in history like any failed request; an open connection is marked as lost; the header checks the agent every 5 s and when
  the window gets focus, so it turns green again once the agent is back.

### Installing the agent

Users open **Settings → General → Local Agent** (or **Server / Local → Local Agent settings…** in the header). It offers the
installers this server has, the one for the user's system first. **Node.js is built into all of them**; nothing else is
needed, and nothing needs administrator rights: the agent is installed for the current user and starts at login.

| System                      | File                                        | What to do                                                                                                                  |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11 (x64)         | `api-client-agent-setup-<v>-windows-x64.exe` | Double-click. It asks for the API Client address, installs to `%LOCALAPPDATA%\api-client-agent`, adds itself to **Settings → Apps → Installed apps** (with Uninstall) and to the user's `PATH`, starts at logon (Task Scheduler, hidden) and shows a pairing code. |
| macOS 12+ (Apple Silicon / Intel) | `api-client-agent-<v>-macos-arm64.zip` / `-x64.zip` | Unzip and double-click `api-client-agent`. It is not notarized: if macOS blocks it, open **System Settings → Privacy & Security → Open Anyway** (macOS 15+), or right-click → **Open** on older versions. It opens in Terminal, asks for the address, installs to `~/Library/Application Support/api-client-agent`, registers a LaunchAgent and shows a pairing code. |
| Debian / Ubuntu (amd64, arm64) | `api-client-agent_<v>_amd64.deb` / `_arm64.deb` | `sudo apt install ./api-client-agent_<v>_amd64.deb`, then **as your normal user** `api-client-agent setup`. The package ships the program in `/usr/lib/api-client-agent` and a systemd *user* unit. |
| Other Linux (x64, arm64)    | `api-client-agent-<v>-linux-x64.tar.gz` / `-arm64` | `tar xzf …` and run `./api-client-agent` in a terminal: installs to `~/.local/share/api-client-agent`, a systemd user service (or an XDG autostart entry without systemd) and `~/.local/bin/api-client-agent`. |

Then, in API Client: **Server / Local → Local**, type the pairing code, **Pair**. The header shows **Local** with a green dot.

Without the installers (or with Node.js 22.13+ already there), the same page shows one-line installs that download the
script version (`agent.mjs`) from this server and check its SHA-256:

```bash
curl -fsSL https://api.example.com/agent/install.sh | sh                                                   # Linux, macOS
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://api.example.com/agent/install.ps1 | iex"  # Windows
node agent.mjs install --server https://api.example.com                                                     # by hand
```

### Managing it

The program is also its command line (`api-client-agent help`; on Windows it is on the user's `PATH` after setup):

| Command | What it does |
| ------- | ------------ |
| `setup [--server URL]` | The guided install the installers run (asks for the address when it is not given). |
| `install --server URL [--port N] [--no-service]` | The same without questions; `--no-service` for a portable copy you start with `run`. |
| `status` | Service state, port, allowed sites, paired tokens, target rules, where the files are. |
| `pair [--origin URL]` | A new one-time pairing code (8 characters, valid 10 minutes, cancelled after 5 wrong tries). |
| `start` · `stop` · `restart` · `run` | Control the background agent; `run` is the foreground process the service starts. |
| `origins [add URL \| remove URL]` · `tokens [revoke ID]` | Sites allowed to use the agent, and paired browsers (removing a site revokes its tokens). |
| `config [get KEY \| set KEY VALUE]` | Agent settings (below). |
| `update [--check] [--force] [--sha256 HASH]` | Installs the version the server offers (checked against its SHA-256; Windows renames the running `.exe` aside). A `.deb` install is updated with the new package instead. |
| `uninstall [--purge]` | Stops it and removes the service, the `PATH` / Installed apps entries and the program; `--purge` also deletes settings, tokens and logs. |

Where things live (`API_CLIENT_AGENT_HOME` puts everything in one folder):

| | Settings, tokens (`config.json`, `tokens.json`) | Program | Logs | Background service |
| --- | --- | --- | --- | --- |
| Linux | `~/.config/api-client-agent` | `~/.local/share/api-client-agent` (`.deb`: `/usr/lib/api-client-agent`) | `~/.local/state/api-client-agent` | `systemctl --user` unit `api-client-agent.service` |
| macOS | `~/Library/Application Support/api-client-agent` | same | `~/Library/Logs/api-client-agent` | LaunchAgent `com.apiclient.agent` |
| Windows | `%APPDATA%\api-client-agent` | `%LOCALAPPDATA%\api-client-agent` | `%LOCALAPPDATA%\api-client-agent\logs` | Task Scheduler task **API Client Agent** (at logon) |

Agent settings (`api-client-agent config set KEY VALUE`, then `restart`):

| Key | Default | Meaning |
| --- | --- | --- |
| `port` | `47823` | Loopback port it listens on (change the **Agent address** in Settings to match). |
| `targets.public` / `targets.private` / `targets.loopback` | `true` | May requests go to the internet / private ranges (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7) / this computer. |
| `targets.linkLocal` | `false` | Link-local addresses, which include cloud metadata endpoints (169.254.169.254 …). |
| `targets.allow` | *(empty)* | When set, only these targets: host names (`*.corp.local`), IPs or CIDRs, comma-separated. |
| `targets.deny` | *(empty)* | Never these targets (wins over everything). |
| `limits.maxTimeoutMs` / `limits.maxResponseBytes` | 10 min / 100 MB | Ceilings on what a run may ask for (the server's ceilings apply too). |
| `limits.maxConcurrent` / `limits.maxSessions` | `32` / `20` | Requests in flight and open live connections. |
| `udpListenPorts` | `1024-65535` | Local UDP ports a "listen" request may bind. |
| `autoUpdate` | `false` | Install the server's newer version by itself once a day. |

### Security of Local mode

The agent is an HTTP service on the user's machine, so it assumes every web page the user opens may try to talk to it:

- **Loopback only.** It refuses to listen on anything but `127.0.0.1` / `::1`.
- **DNS rebinding.** It answers only when the `Host` header is its own loopback address and port (`421` otherwise), so a page
  on `evil.example` that re-resolves to 127.0.0.1 gets nothing.
- **Origins and CORS.** A browser request must come from a site the user allowed (`setup` / `pair --origin`). Other sites get
  `403` and no CORS headers, so their scripts cannot read anything, not even whether the agent exists. Allowed sites get exact
  CORS headers (never `*`, no credentials) and the `Access-Control-Allow-Private-Network` answer that Chrome's Private Network
  Access preflight asks for.
- **Authentication.** Pairing exchanges a one-time code typed by the user for a 256-bit token bound to that site's origin;
  the agent keeps only its SHA-256. Every call except `/v1/health` (name, version, paired yes/no) and `/v1/pair` needs it.
- **CSRF.** No cookies or ambient credentials exist; requests need the `Authorization` header and `application/json` bodies,
  which cross-site forms cannot send and which always trigger a preflight.
- **SSRF / local network access.** The agent uses the server's engine with its own address rules (`targets.*`): link-local and
  metadata addresses are blocked by default, `allow` / `deny` narrow it further, the checked address is the one connected to
  (`lookup` hook, no DNS-rebinding gap), redirects are re-checked, and it never sends requests to itself.
- **Credentials.** The agent stores no API credentials: the server builds each request (with the environment's secrets, which
  the user can already see) and the agent only sends it. Logs record method, target origin and status, never headers or bodies.
  Config and token files are readable by the user only.
- **Authorization stays on the server.** The run endpoints are the same permission checks as `/run` (`request:run`); runs
  waiting for the agent belong to the user and workspace that started them, expire, complete once, and the reported response
  is validated and size-checked again on the server.
- **Updates and downloads** come only from the server the agent was installed from and must match the SHA-256 in its
  manifest (`--sha256` checks against a hash you got another way). Installers download Node.js from nodejs.org and check it
  against `SHASUMS256.txt` when they are built.
- **Operators** can turn Local mode off with `LOCAL_AGENT=false` (the routes answer 403 and the switch disappears).

### Building the installers

**Ready-made installers** for each version are attached to the
[GitHub Releases](https://github.com/HosseinTeimouri79/api-client/releases), with `index.json` and `SHA256SUMS.txt`: pushing a
`vX.Y.Z` tag runs `.github/workflows/release.yml`, which tests, builds them and publishes the release (no personal token needed);
pushes to `main` and pull requests run the tests only. The download table in **Settings → General → Local Agent** links to
the installers of the **latest** release (the server reads it from the GitHub API and keeps it for 10 minutes;
`AGENT_RELEASES` picks the repository). When GitHub cannot be reached, or with `AGENT_RELEASES=off`, it lists this server's
own installers instead: download all files of the release that matches your server's version into `AGENT_INSTALLERS_DIR`
(default `./build/installers`). Installed agents always update from the server's `/agent/manifest.json`.

To build them yourself:

```bash
npm run build                 # the UI and dist/agent/agent.mjs
npm run build:installers      # build/installers/: all systems (or: -- --targets linux-x64,win32-x64)
```

`agent/packaging/build.mjs` bundles the agent into one CommonJS file, turns it into a Node.js
[single executable application](https://nodejs.org/api/single-executable-applications.html) and injects it (`postject`) into
the official Node.js binary of each system, downloaded once into `.cache/` and verified against nodejs.org's
`SHASUMS256.txt`. It runs on Linux or macOS; the `.deb` needs `dpkg-deb`. macOS binaries are signed ad hoc (`codesign` on a
Mac, otherwise `rcodesign`, fetched and checksum-verified automatically). The server serves whatever `index.json` in
`AGENT_INSTALLERS_DIR` lists under `/agent/download/` and in `/agent/manifest.json`, which installed agents use for updates.
With Docker, build them on a build machine and mount the folder (`./build/installers:/installers:ro` in `docker-compose.yml`).

For distribution outside your organization, sign them: Windows with your code-signing certificate (`signtool`, or
`osslsigncode` on Linux) to avoid SmartScreen warnings; macOS with a Developer ID and notarization. On a Mac,
`agent/packaging/macos-pkg.sh` turns the macOS binary into a signed, notarized `.pkg` installer when you set
`DEVELOPER_ID_APP`, `DEVELOPER_ID_INSTALLER` and `NOTARY_PROFILE`.

### Known limits

- **Browsers.** Chrome, Edge and Firefox allow an HTTPS page to call `http://127.0.0.1`. Recent Chrome versions may ask
  once whether the site may access devices on the local network: allow it. Safari may block it; use another browser for
  Local mode there.
- The installers are not code-signed or notarized by this project (see above); Windows shows SmartScreen ("More info → Run
  anyway") and macOS needs "Open Anyway" the first time. Setup removes the quarantine flag from the copy it installs.
- No `.rpm` is built; on Fedora, RHEL and others use the `.tar.gz`.
- Secrets in environments reach the browser in Local mode as part of the built request; they are the values the user can
  already read in the workspace, and the agent does not keep them.

---

## Configuration

All configuration is through environment variables (`.env.example` lists the common ones).

| Variable                      | Default                | Description                                                                                     |
| ----------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                  | random (development)   | Secret used to sign sessions. **Required in production.** Generate with `openssl rand -hex 32`. |
| `PORT`                        | `3000`                 | HTTP port.                                                                                      |
| `DB_PATH`                     | `./data/app.db`        | SQLite file (`/data/app.db` in Docker).                                                         |
| `NODE_ENV`                    | –                      | `production` enables secure cookies and requires `JWT_SECRET`.                                  |
| `COOKIE_SECURE`               | `true` in production   | Set `false` only for plain-HTTP local use.                                                      |
| `TRUST_PROXY`                 | `false`                | `true` behind a reverse proxy so rate limiting uses the client IP.                              |
| `ADMIN_USERNAMES`             | –                      | Comma-separated usernames promoted to administrator on every start (recovery / bootstrap).      |
| `ALLOW_PRIVATE_TARGETS`       | `false`                | SSRF guard off-switch: allow requests to localhost and private networks. Development only.      |
| `SCRIPT_TIMEOUT_MS`           | `1500`                 | CPU budget of a script.                                                                         |
| `REQUEST_TIMEOUT_MS`          | `30000`                | Default time a request waits for a response.                                                    |
| `MAX_RESPONSE_BYTES`          | `10485760` (10 MB)     | Default maximum response size.                                                                  |
| `MAX_REQUEST_TIMEOUT_MS`      | `600000` (10 min)      | Ceiling for the per-user timeout in Settings (`0` lifts the ceiling).                           |
| `MAX_RESPONSE_BYTES_LIMIT`    | `104857600` (100 MB)   | Ceiling for the per-user response size in Settings (`0` lifts the ceiling).                     |
| `CONNECT_ATTEMPT_TIMEOUT_MS`  | `5000`                 | Connect budget per resolved address.                                                            |
| `MAX_SESSIONS_PER_USER`       | `10`                   | Open live connections (WebSocket, ...) one user may hold at the same time.                      |
| `MAX_SESSIONS_TOTAL`          | `200`                  | Open live connections on the whole server.                                                      |
| `UDP_LISTEN_PORTS`            | *(empty: listening off)* | Local UDP ports (or ranges, `40000-40100,50000`) a user may *listen* on; with Docker, publish them too.        |
| `SESSION_IDLE_MS`             | `900000` (15 min)      | A live connection nobody watches or uses for this long is closed.                               |
| `SESSION_EVENT_LIMIT`         | `5000`                 | Events kept per live connection (what a reconnecting browser can still replay).                 |
| `LOCAL_AGENT`                 | `true`                 | Offer Local mode (requests sent by the [Local Agent](#local-agent) on the user's computer). `false` turns it off. |
| `PUBLIC_URL`                  | from the request       | The address users open the app at (`https://api.example.com`); used in the agent's install commands.  |
| `AGENT_INSTALLERS_DIR`        | `./build/installers`   | Folder with the agent installers from `npm run build:installers` (`/installers` in Docker).           |
| `AGENT_RELEASES`              | from `package.json`    | GitHub repository (`owner/name`) whose latest release the download table links to; `off`: this server's installers only. |
| `GITHUB_API_URL`              | `https://api.github.com` | GitHub API address (GitHub Enterprise).                                                              |
| `AGENT_DEFAULT_URL`           | `http://127.0.0.1:47823` | Where the browser looks for the agent unless the user changes it.                                   |
| `CHROME_PATH`                 | auto-detected          | Chromium/Chrome binary for the end-to-end tests.                                                |

**Per-user limits.** Each user can set a request timeout and maximum response size under **Settings → General → Request**.
A value of `0` means "as much as the server allows", i.e. the two ceilings above. Operators who want no ceiling at all can set
a ceiling to `0`.

**Database and migrations.** Migrations run automatically at start (`server/db/migrations.js`). They are append-only,
transactional and tracked in the `_migrations` table: to change the schema add a new entry with the next `id`, never edit an
applied one.

---

## Using the app

### Workspaces, collections and requests

- A **workspace** is a shared space. Create one from the top bar. Invite people from **⋯ → Members** (the picker lists every user
  who is not a member yet and is searchable by name or username).
- **Collections** and **sub-collections** form a tree in the sidebar. Right-click or use the **⋯** button for rename, duplicate,
  move to root, sort, export and delete. Drag and drop to reorder or move. Click a collection to open its settings:
  variables, authorization, pre/post-request scripts and a description that every request inside inherits (variables, auth
  and scripts).
- **New request and sub-collection:** the **+** on a collection opens one small popover: *New sub-collection*, then the protocols
  (HTTP, WebSocket, gRPC, GraphQL, SSE, TCP, UDP, MQTT, AMQP); picking a protocol creates the request in that collection right
  away (named "New Request", rename it in the editor). The **+** above the tree is the same menu with *New collection*, and a
  request made there is not saved yet (Save asks for a collection). `Ctrl/⌘+T` and the tab bar's **+** still open an HTTP request.
- A **request** has Params, Headers, Body, Auth, Pre-request, Post-request and Description tabs. A tab shows a **●** badge
  when it has content. Type `{{` in any field to pick a variable.
- Press **Send** (or `Ctrl/⌘+Enter`). The response panel shows the body (JSON tree, raw or HTML preview), headers, test
  results and the request that was actually sent. By default the response is shown **below** the request; change it with
  the layout button or in Settings.

### Variables and environments

Variables use `{{name}}`. Precedence from highest to lowest:

1. runtime variables (set by scripts for one run),
2. request variables,
3. collection variables (nearest collection first),
4. the selected environment,
5. workspace (global) variables.

Environments are managed from the **environment selector** in the top bar: hover an environment for a pen (edit its name and
variables) and a trash icon (delete, with confirmation), and the last entry, **New environment…**, opens one dialog for the name
and the variables and makes the new environment the active one. The workspace (global) variables are under **⋯ → Workspace
(global) variables**. Importing and exporting environments (Postman or Hoppscotch) is part of **⋯ → Import / Export**. Secret
variables are never substituted into generated code snippets.

### Code snippets

The **Code** button next to Save generates code for the request exactly as edited (see [Code snippets](#code-snippets)).

<a id="protocols"></a>

### Protocols

Pick the protocol in the box left of the URL. HTTP sends one request and shows one response; the other protocols keep a
connection open (a *session*) and show everything that happens on it in the right-hand pane. Protocols that are not built yet
are listed as "soon". Requests of every protocol are saved in collections like any other; Postman and Hoppscotch exports leave
non-HTTP requests out and say so in the warnings.

**HTTP.** GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE and CONNECT. `TRACE` and `CONNECT` are sent without a body.
For `CONNECT` the URL is the proxy and the tunnel target is its path, e.g. `http://proxy:3128/example.com:443`; the proxy's
answer is shown and the tunnel is closed again.

**WebSocket.** Connect, Send, Ping, Pong and Close.

- The URL can be `ws://`, `wss://`, `http://` or `https://` (mapped to `ws`/`wss`); query params, headers and auth work as in HTTP.
  Subprotocols go in the **Settings** tab (comma separated; the server picks one, shown next to the status).
- **Message** tab: compose text or binary (base64 / hex) messages with `{{variables}}`; **Ctrl+Enter** sends. Ping and Pong
  take an optional payload (up to 125 bytes); the browser sends a pong for you when the server pings. **Close** takes a code
  (1000 or 3000–4999) and a reason. The draft is saved with the request.
- The right pane lists connection events, messages in both directions (JSON is pretty-printed when opened), pings, pongs and the
  close code, with filters (all / sent / received / events), a **Handshake** tab with the response headers, and Clear.
- A connection ends when you disconnect, close the tab, switch workspace or sign out, and after `SESSION_IDLE_MS` without
  anyone watching it. Viewers may connect (like running an HTTP request). Private addresses are blocked like in HTTP unless
  `ALLOW_PRIVATE_TARGETS=true`.

**gRPC.** Unary, server streaming, client streaming and bidirectional calls.

- The URL is `grpc://host:port` (plaintext), `grpcs://host:port` (TLS), or `http://` / `https://` / a bare `host:port`.
- Paste the service's `.proto` in the **Proto** tab (one file; Google's well-known types such as `Timestamp` and `Any` can be
  imported, other imports are not supported). The server parses it and lists the services and methods; picking a method inserts
  an example request message. There is no server reflection.
- **Message** tab: the request as JSON (`{{variables}}` work). Invoke sends it for unary and server-streaming methods. For
  client-streaming and bidirectional methods, Invoke opens the call and you **Send message** as often as you like and **End
  stream** when done; **Cancel** aborts. Responses are shown as JSON (64-bit integers as strings, enums by name, bytes as base64).
- **Metadata** tab holds the request metadata (headers; keys ending in `-bin` are sent as binary from base64). Bearer, Basic and
  API-key auth become metadata. Response headers, trailers and the final status (`OK`, `NOT_FOUND`, ...) are listed in the log
  and in the **Metadata** pane.
- **Settings:** a deadline in milliseconds (`0` = the request timeout from Settings for unary calls, none for streams) and an
  option to skip TLS certificate verification for test servers with self-signed certificates.
- The server resolves the host name once, refuses private addresses (unless `ALLOW_PRIVATE_TARGETS=true`) and connects to the
  address it checked.

**GraphQL.** Queries, mutations and subscriptions in one editor.

- Write the document in the **Query** tab and the variables (a JSON object) below it. The document is analysed as you type:
  a badge shows whether the selected operation is a query, mutation or subscription, syntax errors are shown with their line
  and column, and a document with several operations asks which one to run.
- **Queries and mutations** are sent as an ordinary HTTP request, so everything from HTTP applies: headers, auth, variables,
  pre-request and post-request scripts, tests, history, limits and the response viewer. By default the body is
  `{ "query", "variables", "operationName" }` as JSON (`POST`); **Settings** can switch queries to `GET` (parameters in the URL;
  mutations refuse it). The **Code** button generates the equivalent HTTP request in any of the snippet languages. Scripts see the
  HTTP request but not the GraphQL document: change it with `{{variables}}` instead.
- **Subscriptions** use a WebSocket: **Send** becomes **Subscribe** and the right pane shows every result as it arrives, until
  the server completes or you **Unsubscribe**. Both `graphql-transport-ws` (current) and the legacy `graphql-ws`
  (`subscriptions-transport-ws`) are supported. In **Settings** you can give a separate WebSocket URL (otherwise the request URL
  is used, `http` → `ws`, `https` → `wss`) and connection parameters (JSON sent with `connection_init`, e.g. a token).
- **Schema** tab: *Fetch schema* runs an introspection query through the same request (auth, scripts and address checks) and
  shows the schema as SDL with descriptions; the filter keeps the matching type blocks.

**SSE (Server-Sent Events).** Start a stream and watch the events arrive.

- `GET` (default) or `POST` with a body, for the APIs that stream over POST. The request is sent with
  `Accept: text/event-stream`; params, headers, auth and `{{variables}}` work as in HTTP. Redirects are followed.
- Each event appears in the log with its name (`event:`), id and data (multi-line `data:` is joined, JSON is pretty-printed when
  opened); comments (keep-alive lines), `retry:` hints and reconnects are listed as events. The **Response** tab shows the
  status and headers. An answer that is not `text/event-stream`, or an error status, is shown with the server's reply.
- **Settings:** *Reconnect when the server ends the stream* waits for the server's `retry:` delay (3 seconds by default), reopens the
  stream with `Last-Event-ID` and gives up after the chosen number of reconnects. **Stop** ends the stream.
- A single event cannot be larger than the response limit from Settings (default 10 MB).

**TCP.** Connect, Send and Close on a raw socket (plain or TLS).

- The address is `tcp://host:port` or `tls://host:port` (`tcps://`, `ssl://` also mean TLS); a bare `host:port` is plain TCP. A
  port is required. There are no headers, params or auth for a raw socket.
- **Message** tab: text (with an optional line ending: none, LF or CRLF), base64 or hex, with `{{variables}}`; **Ctrl+Enter**
  sends. Data received within a few milliseconds is shown as one message (TCP splits data arbitrarily). Messages that are not text
  are shown as base64 and, when opened, as a hex dump. The server closing its side shows as an event and ends the session.
- **Connection** tab: remote and local address and, for TLS, the version, cipher, certificate subject, issuer, validity,
  fingerprint and whether it is trusted. **Settings:** skip certificate verification (self-signed test servers) and an SNI /
  certificate name override.
- Disconnecting closes the socket; the received data is limited like HTTP responses (Settings → Request, default 10 MB per
  connection). Private addresses are refused unless `ALLOW_PRIVATE_TARGETS=true`.

**UDP.** Send and Receive datagrams.

- The address is `udp://host:port` (a bare `host:port` works too; a port is required). **Open socket** creates a socket on a random
  local port; the **Message** tab (text with optional LF/CRLF, base64 or hex, `{{variables}}`) sends a datagram to the address and
  the answers appear in the log with the address they came from. A datagram holds at most 65,507 bytes.
- By default only datagrams that come from the address are shown (others are listed as *ignored*); **Settings** can switch that
  off to read answers from another address or port.
- **Listen mode** binds a local port on the server so you can receive datagrams sent by other devices. Because that opens a port
  on the machine that runs the app, it is **off** unless the administrator allows ports with `UDP_LISTEN_PORTS` (for example
  `40000-40100`; publish the same range with Docker). The URL is then optional and only used for sending.
- Hosts are resolved once and private addresses are refused unless `ALLOW_PRIVATE_TARGETS=true`; the response limit applies to
  what a socket receives.

**MQTT.** Connect, Publish, Subscribe, Unsubscribe and Disconnect.

- The address is `mqtt://host:1883`, `mqtts://host:8883` (TLS), `ws://` or `wss://` (MQTT over WebSocket, subprotocol `mqtt`);
  `tcp://`, `tls://`, `ssl://`, `http://` and `https://` are accepted as aliases, a bare `host` means `mqtt://`.
- **Settings:** client ID (random when empty), user name and password, MQTT version (3.1.1 by default, 3.1 or 5.0), keep-alive,
  clean session, skip TLS verification, and a **last will** (topic, payload, QoS, retain). All fields accept `{{variables}}`, so
  credentials can live in an environment.
- **Publish** tab: topic, payload (text, base64 or hex), QoS 0 / 1 / 2 and retain; **Ctrl+Enter** publishes. Topics with wildcards
  are refused before sending.
- **Subscribe** tab: add topic filters (`+` one level, `#` the rest) with a QoS; the active subscriptions are listed with an
  Unsubscribe button. Every incoming message shows its topic, QoS and whether it was retained; non-text payloads show as base64.
- **Disconnect** sends DISCONNECT (so the broker does not publish the last will); closing the tab or the server's idle timeout
  drops the connection instead, which does publish it. MQTT 5 is sent as the protocol version only (no user properties yet).

**AMQP (0-9-1, RabbitMQ and others).** Publish, Consume, Ack and Reject.

- The address is `amqp://user:password@host:5672/vhost` or `amqps://…` (TLS). The virtual host is the path (`/%2F` is the default
  `/`); credentials come from the URL or from **Settings** (guest / guest when neither is given).
- **Publish** tab: exchange (empty = the default exchange, where the routing key is a queue name), routing key, payload (text, base64
  or hex) and the properties content type, type, correlation id, reply-to, message id, expiration, headers (JSON), persistent and
  *mandatory* (the broker returns a message no queue accepted, shown as an event). Publishes wait for the broker's confirmation.
- **Consume** tab: the queue, optionally declared first (durable, exclusive, auto-delete; an empty name gives a broker-named queue)
  and bound to an exchange (which can be created as direct, fanout, topic or headers), prefetch and automatic acknowledgement.
  Consumers are listed with a Cancel button.
- Every delivery shows its routing key, exchange, delivery tag, redelivered flag and properties. While it waits for an
  acknowledgement the log row has **Ack**, **Requeue** and **Discard** buttons, and the Consume tab can **acknowledge all**.
  Unacknowledged messages go back to the queue when the connection ends, as with any AMQP client.
- A broker error (such as a missing queue) closes only the channel; the session opens a fresh one for the next action. Tests run
  against an in-process broker; set `AMQP_TEST_URL` to also run one test against a real broker.

### History and console

History is stored per user and workspace (latest 200 runs). The console shows structured logs of every run, including
`console.log` from scripts. It starts collapsed; toggle it with `` Ctrl/⌘+` `` or open it on start in Settings.

### Settings

Open **Account menu → Settings**.

- **Profile**: *Profile details* (photo, display name, username) and *Change password* (the button enables once all three
  fields are filled).
- **General**: *Application* (theme, language, app font, autosave), *User interface* (open the console on start, layout
  type), *Request* (timeout and maximum response size), *Editor* (font, size, indentation, auto-close brackets and
  quotes), *About* (version and license).

Settings are saved to your account, so they follow you across devices.

### Keyboard shortcuts

`Ctrl/⌘+Enter` send · `Ctrl/⌘+S` save · `Ctrl/⌘+T` new tab · `` Ctrl/⌘+` `` toggle console · `Esc` closes dialogs and menus.

---

## Import and export (Postman and Hoppscotch)

API Client reads and writes both formats, so you can move collections and environments in either direction. The format of a
file is **detected automatically** on import.

| Format                       | Import | Export | Notes                                                                                     |
| ---------------------------- | :----: | :----: | ----------------------------------------------------------------------------------------- |
| Postman collection (v2.1)    |   ✓    |   ✓    | one collection per file                                                                   |
| Postman environment          |   ✓    |   ✓    | exported one at a time; secrets keep their `secret` type                                  |
| Hoppscotch collection        |   ✓    |   ✓    | a file can hold several collections                                                       |
| Hoppscotch environment       |   ✓    |   ✓    | exported one at a time (as a one-item list)                                               |

### How to import

- **Import / Export** dialog (**⋯ → Import / Export**): choose one or several `.json` files, optionally a destination collection
  (collections only), then **Import**. Collection and environment files can be mixed in one go: the format is detected per file.
  The empty sidebar also has an **Import** button next to **New collection**.

Anything that cannot be converted is listed as a **note** after the import instead of failing silently. You need the editor
role (or higher) to import.

### How to export

- Collection context menu (**⋯ → Export as Postman / Export as Hoppscotch**).
- **Import / Export → Export**: pick the format and *what to export* (a collection, all top-level collections — Hoppscotch only —
  or one environment).


### What is converted

| Concept                                 | Postman                                   | Hoppscotch                                        |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Folders / sub-collections               | ✓                                         | ✓                                                 |
| Methods, URLs, query params, headers    | ✓ (disabled rows kept disabled)           | ✓ (disabled rows kept disabled)                   |
| Bodies                                  | raw (JSON/text), URL-encoded, form-data (text), GraphQL (as JSON) | JSON, text, URL-encoded, form-data (text) |
| Auth                                    | Bearer, Basic, API key (inherit/none)     | Bearer, Basic, API key (inherit/none)             |
| Pre-request / post-request scripts      | ✓ (`prerequest` / `test` events)          | ✓ (converted between `pw.*` and `pm.*`)           |
| Collection and folder variables         | ✓                                         | not representable: move them to an environment on export |
| Collection-level scripts                | ✓                                         | not exported (reported as a note)                 |
| Descriptions (collection, folder, request) | ✓ (`info.description`, folder and request `description`) | no equivalent: not exported (reported as a note) |
| `{{variable}}` syntax                   | `{{name}}`                                | converted to and from `<<name>>`                  |

Not converted: file uploads in form-data, Postman body types other than the ones above, and non-text auth types
(these are reported as notes). Inherited auth is copied into each request when exporting to Hoppscotch.

---

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

`pm.request`: `url`, `method`, `headers` / `params` (`add upsert remove get has toObject all clear`), `body` (`raw`, `mode`,
`urlencoded`, `formdata`, `update()`). `{{variables}}` are resolved **after** the script, so the value you just set is used.
The **Request** tab of the response shows what was actually sent (with a badge when a script changed it) and the console logs
`Request modified by pre-request script`.

### Post-request: change what the UI receives, test, store values

```js
const data = pm.response.json();
if (data.token) pm.environment.set("token", data.token);
pm.response.setBody({ count: data.items.length, items: data.items }); // object or string
pm.response.setStatus(200, "OK");  pm.response.setHeader("X-Processed", "1");
pm.test("Status is 200", () => pm.response.to.have.status(200));
```

The response panel is marked **modified by script** when a post script changed it. Collection scripts run first (outermost →
nearest), each seeing the previous one's result.

### Reference

- `pm.variables / environment / globals / collectionVariables` (`get set unset has clear toObject`; `pm.variables.get` and
  `replaceIn` resolve every scope), `postman.setGlobalVariable / getGlobalVariable / setEnvironmentVariable …`.
- `pm.response` (`json() text() code status headers.get() responseTime`, `to.have.status/header/jsonBody`,
  `to.be.ok/success/error`), `pm.test`, `pm.expect` (jest `toBe toEqual …` **and** chai `to.equal .eql .include .have.property
  .be.a("string") …`).
- `CryptoJS` / `require("crypto-js")` (SHA1/256/MD5, HMAC, Base64, AES …), `btoa/atob`, `console.*`.
- Not supported: `pm.sendRequest` (network access is blocked by design).
- `pm.environment.set` and `pm.globals.set` persist for editors and above (globals are the workspace variables); runs by
  viewers never persist anything.

In the editor, type `pm.` for completions and use **Snippets** for ready-made examples.

---

## Code snippets

The **Code** dialog turns the request, **as currently edited**, into code. cURL is the default; an autocomplete (grouped by
language, searchable by any words such as `py req` or `node ax`) switches the target, and your last choice is remembered.

Variables are substituted; secret and undefined ones stay as `{{name}}`. Auth inherited from the collection is applied.
Pre-request scripts are not applied.

| Language      | Targets                                                |
| ------------- | ------------------------------------------------------ |
| C#            | HttpClient, RestSharp                                  |
| cURL          | cURL                                                   |
| Dart          | Dio, HTTP                                              |
| Go            | http package                                           |
| HTTP          | Raw HTTP request                                       |
| Java          | OkHttp, Unirest                                        |
| JavaScript    | Fetch, jQuery, XHR                                     |
| Kotlin        | OkHttp                                                 |
| C             | LibCurl                                                |
| Node.js       | Axios, Native, Request, Unirest                        |
| Objective-C   | NSURLSession                                           |
| OCaml         | Cohttp                                                 |
| PHP           | cURL, Guzzle, Http_Request2, pecl_http                 |
| Postman CLI   | Postman CLI                                            |
| PowerShell    | RestMethod                                             |
| Python        | http.client, Requests                                  |
| R             | httr, RCurl                                            |
| Ruby          | Net::HTTP                                              |
| Rust          | reqwest                                                |
| Shell         | HTTPie, wget                                           |
| Swift         | URLSession                                             |

The cURL, wget, Python (`http.client`, `requests`), Node `fetch` and Node native snippets are executed against a local server
in the test suite; the JavaScript, Python, shell and C output is syntax-checked.

---

## Languages

The interface is available in **English (en-US), Spanish (es-ES), Chinese (zh-CN), German (de-DE), French (fr-FR), Japanese
(ja-JP), Portuguese (pt-BR), Korean (ko-KR), Hindi (hi-IN), Italian (it-IT), Indonesian (id-ID), Turkish (tr-TR), Arabic
(ar-SA), Russian (ru-RU) and Persian (fa-IR)**.

- Pick a language with the flag + name selector in the top bar, on the sign-in screen or in Settings. Your browser's language
  is detected on first visit; once you are signed in, the language saved on your account wins.
- **Arabic and Persian are right-to-left**: the whole page mirrors (the sidebar moves to the right, tabs, menus and dialogs
  flip). Code, URLs, JSON and other technical content always stay left-to-right.
- Product and format names (Postman, Hoppscotch, JSON, cURL, Bearer, …) are never translated.
- The server still answers in English; the common error messages are mapped to the interface language in the browser.

**Adding a language:** create `web/src/i18n/locales/<code>.js` (copy `en-US.js` and translate the values), add it to
`web/src/i18n/locales.js` (name, flag, direction) and `src/services/locales.js`, and draw its flag in
`web/src/components/ui/Flag.jsx`. `npm test` checks that every dictionary has exactly the same keys and placeholders as
`en-US.js`, that nothing is left empty, and that no UI text is hard-coded in the components.

---

## Accounts, roles and administration

### Accounts

You sign in with a **username and password** (no email). Usernames are 3–32 characters (`A–Z a–z 0–9 . _ -`),
case-insensitive. **The first account that registers becomes the administrator** (on upgrades, the oldest existing account).
Self-registration can be turned off in the admin panel so that only admins create accounts; then people sign in with the
password they were given and can change it under *Settings → Profile → Change password*.

### Workspace roles

| Role   | Run | Edit requests/collections/scripts/envs | Manage members & workspace            | Delete workspace |
| ------ | :-: | :------------------------------------: | :-----------------------------------: | :--------------: |
| Viewer |  ✓  |                                        |                                       |                  |
| Editor |  ✓  |                   ✓                    |                                       |                  |
| Admin  |  ✓  |                   ✓                    | ✓ (cannot grant admin / change owner) |                  |
| Owner  |  ✓  |                   ✓                    |                   ✓                   |        ✓         |

Viewers can change anything in a request tab to try it out and run it, but nothing they change can be saved, and their runs
never persist environment changes.

### Administrator panel

Administrators (a platform-level flag, separate from workspace roles) get **Account menu → Admin panel**:

- **Users**: search, create, edit name/username/administrator flag, reset a password, disable or delete accounts. Password
  reset and disabling sign the user out everywhere. You cannot demote, disable or delete yourself, and a user who owns a
  workspace cannot be deleted until the workspace is removed.
- **Workspaces**: list and delete.
- **Activity**: a log of administrator actions.
- **Settings**: *Allow self-registration* on or off (the very first account is always allowed).

---

## HTTP API

The UI talks to a JSON API under `/api`. You can use it directly.

- **Authentication**: sign in with `POST /api/auth/login` (`{ "username", "password" }`). The response contains a `token`; send it as
  `Authorization: Bearer <token>`. Browsers use an httpOnly cookie instead, and cookie-authenticated writes must also send
  the header `X-Requested-With: api-client` (CSRF protection).
- Errors are `{ "error": "message" }` (validation errors add `details`).

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"alice","password":"secret-pass"}' | jq -r .token)
curl -s http://localhost:3000/api/workspaces -H "authorization: Bearer $TOKEN"
```

| Area       | Endpoints                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Auth       | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/config`                         |
| Profile    | `PATCH /me` (name, username, locale, settings), `PUT`/`DELETE /me/avatar`, `POST /me/password`, `GET /users/:id/avatar`    |
| Workspaces | `GET`/`POST /workspaces`, `GET`/`PATCH`/`DELETE /workspaces/:wid`, members, audit, environments                            |
| Content    | `GET /workspaces/:wid/tree`, collections (`POST`, `PATCH`, `DELETE`, duplicate, scripts, auth), requests (`POST`, `PUT`, move, duplicate, `DELETE`) |
| Running    | `POST /workspaces/:wid/run` (with optional `limits`), `GET`/`DELETE /workspaces/:wid/history`                              |
| Live       | `POST /workspaces/:wid/sessions` (open a connection), `GET .../sessions/:id/events?since=` (Server-Sent Events), `POST .../sessions/:id/act` (`send`, `ping`, `pong`, `close`, `end`, `cancel`), `POST /workspaces/:wid/grpc/describe` (parse a `.proto`), `POST /workspaces/:wid/graphql/analyze`, `POST /workspaces/:wid/graphql/introspect`, `DELETE .../sessions/:id`, `GET .../sessions` |
| Interop    | `GET /workspaces/:wid/export?format=postman\|hoppscotch&collection=…\|environment=…`, `POST /workspaces/:wid/import`        |
| Admin      | `/admin/stats`, `/admin/users` (list, create, `PATCH`, password, `DELETE`), `/admin/workspaces`, `/admin/audit`, `/admin/settings` |
| Health     | `GET /healthz`                                                                                                             |

---

## Architecture

### Stack

| Layer         | Choice                                                                        | Why                                                                                          |
| ------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Backend       | Node 22 + Express 5 routers, zod validation                                   | small, well understood, easy to extend                                                       |
| Database      | SQLite (`node:sqlite`, WAL, foreign keys on) + versioned migrations           | zero ops, single file, no native build; the data layer is isolated in `server/db`               |
| Auth          | username + password (bcrypt), JWT in an httpOnly SameSite=Strict cookie or Bearer | CSRF-resistant (custom header required for cookie auth)                                  |
| Script engine | QuickJS compiled to WASM (`quickjs-emscripten`)                               | a real sandbox: no fs/net/process, CPU and memory limits                                     |
| Frontend      | React 19 + Vite + zustand (`web/`, built to `dist/`)                          | in-house component library (no UI kit); React escapes by default; Vite is build-time only    |

### Layout

Four parts, with one rule each (`tests/architecture.test.js` enforces them):

| Part | What it is | May use |
| --- | --- | --- |
| `core/` | The request engine: building and sending requests, the SSRF / address guard, the nine protocols, live sessions. No Express, no database, no UI. | its npm packages (ws, gRPC, MQTT, AMQP, GraphQL, zod) |
| `core/shared/` | Plain JavaScript that also runs in the browser: protocol and method lists, `{{variable}}` resolution. | only `core/shared` |
| `server/` | The API Client server: Express routes, SQLite, accounts and permissions, scripts (QuickJS), the run pipeline, Local-mode prepare / complete. | `core` |
| `agent/` | The Local Agent: its CLI, its HTTP API and security, OS integration, packaging. | `core` (never `server`) |
| `web/` | The React UI. | `core/shared` only |

So the server and the Local Agent send requests with the same code, and the UI resolves variables and lists protocols
exactly as they do.

```
core/
  config.js      engine settings (limits, timeouts, sessions, UDP ports, SSRF switch); configureEngine()
  executor.js    build a request, send it (manual redirects, limits), the wire format for the agent
  ssrf.js        address checks with a replaceable policy (the server's: public only; the agent's: agent/src/policy.js)
  sessions.js    live sessions: connection, numbered event log, replay
  protocols/     common.js connectors.js websocket.js grpc.js graphql.js sse.js tcp.js udp.js mqtt.js amqp.js
  shared/        protocols.js (protocols, HTTP methods) variables.js (scopes, {{var}} resolution)
server/
  app.js server.js config.js (extends core/config.js)
  db/            index.js (open + migrate)  migrations.js (append-only)
  middleware/    auth.js (authenticate, csrfGuard, requireWorkspace, requireAdmin, audit)
  routes/        auth.js me.js admin.js workspaces.js content.js interop.js sessions.js protocolTools.js agent.js
  services/      runner.js (pipeline, split around the network call) localMode.js pendingRuns.js scriptEngine.js
                 permissions.js interop.js (Postman/Hoppscotch) settings.js userSettings.js locales.js
agent/           the Local Agent (one program for Linux, macOS and Windows; see Local Agent)
  src/           main.js (CLI) server.js (API: Host/Origin/token checks) policy.js (target rules) store.js (config, pairing,
                 tokens) service.js (systemd / launchd / Task Scheduler) integration.js (PATH, Installed apps) update.js paths.js
  install/       install.sh install.ps1 (script installs, served with the server's address filled in)
  packaging/     build.mjs (standalone executables, .exe / .zip / .deb / .tar.gz) macos-pkg.sh release-notes.mjs
  vite.config.js bundles agent + core to dist/agent/agent.mjs
web/             index.html vite.config.js
  src/           main.jsx App.jsx store.js api.js
    components/  ui (AutoComplete Select Popover Menu Modal Toasts Splitter Flag LanguageSelect …)
                 editor (VarInput CodeEditor KeyValueEditor BodyEditor AuthEditor ScriptEditor)
                 response (ResponseViewer JsonTree)
    features/    TopBar Sidebar RequestEditor RequestTabs Console CodeSnippet SettingsPage AdminPanel AgentMode + dialogs
    lib/         transport.js (Server / Local mode) agent.js (Local Agent client) codegen (35 snippet targets) settings http …
    i18n/        index.js locales.js locales/<code>.js
dist/            build output served by Express (npm run build)
build/installers the installers from npm run build:installers (served under /agent/download/)
tests/           unit, API and end-to-end tests
.github/         workflows/release.yml (tests on every push; installers and the GitHub Release on version tags)
```

### Data model

`users` (unique username, `is_admin`, `disabled`, `token_version`, avatar, `locale`, `settings`) · `workspaces` (variables) ·
`workspace_members` (role) · `collections` (parent tree, description, variables, auth, pre/post scripts) · `requests` (protocol, protocol data, method,
url, params, headers, body, auth, variables, scripts, description) · `environments` · `history` (per user) · `audit_log` ·
`settings` (instance settings such as registration) · `_migrations`.

Migrations: 1 initial schema · 2 username login · 3 admin panel (admin/disabled/token version) · 4 profile (avatar, locale) ·
5 instance settings · 6 collection description · 7 per-user settings · 8 full locale codes.

### Request pipeline (`server/services/runner.js`)

1. Load the variable scopes.
2. Run pre-request scripts (collections root→leaf, then the request). A script may rewrite url, method, headers, params and
   body (`pm.request.*`).
3. Resolve `{{vars}}` (runtime > request > collection > environment > workspace).
4. Build the request (params, auth including inherited auth, body mode).
5. Execute it: manual redirects, an SSRF check on every hop and on every connected IP, the user's timeout and size limits
   capped by the server ceilings.
6. Run post-request scripts and tests; a script may rewrite status, headers and body before the UI gets them.
7. Persist environment changes **only if the caller may write**.
8. Record history (the unresolved request, never resolved secrets). Every step appends a structured log to the console.

### Authorization

Workspace roles are `owner > admin > editor > viewer`; `server/services/permissions.js` is the single permission table, and
`requireWorkspace(db, perm)` loads the membership from the database on every request (never trusting the client) and answers
404 to non-members. Admins cannot grant admin or touch peers or the owner; the owner is immutable; nobody changes their own
role. Administrator access (`users.is_admin`) is separate and guards `/api/admin`.

### Scaling and performance

The tree endpoint returns names only (collections carry `has_pre`/`has_post` booleans, and `GET /collections/:id/scripts`
returns the inherited script chain on demand); request details load lazily; collapsed branches are not rendered; search is
debounced; history is capped at 200 rows per query. To scale out, move to PostgreSQL with a shared session secret — the app is
otherwise stateless.

### Design decisions

- **SQLite first.** Zero-ops team deployments; single writer mitigated by WAL. Revisit above ~50 concurrent writers.
- **QuickJS-WASM for scripts.** Node `vm` is not a security boundary and `isolated-vm` needs native builds.
- **Server-side execution.** No CORS problems, shared history and consistent scripting, at the price of SSRF risk (handled below).
- **Local mode keeps the pipeline on the server.** The agent only makes the network call; scripts, variables, permissions and
  history stay in one place, so both modes behave the same and the agent stays small. The agent reuses the server's engine
  (`core/`) rather than a second implementation; `tests/architecture.test.js` keeps `core` free of server code.
- **Agent installers as Node.js single executables.** One code base, no runtime to install, and every target can be built from
  Linux; per-user installs need no administrator rights.
- **React + Vite, in-house components.** Keeps the dependency surface small; the production image only ships `dist/`.
- **Username login.** Email was never verified or used, so it was dropped.
- **Dictionaries, not hard-coded text.** All UI text lives in `web/src/i18n/locales`; a test fails when a component hard-codes
  user-facing text.

---

## Security

- **Local mode**: the Local Agent's own protections (loopback only, Host check, origin allow-list, pairing tokens, target rules)
  are described in [Security of Local mode](#security-of-local-mode).
- **SSRF**: private, loopback, link-local and metadata ranges are blocked. The check runs on the DNS-resolved IP (anti-rebinding via
  a `lookup` hook), IP literals are validated explicitly, redirects are re-checked and credentials are dropped on cross-origin
  redirects. `ALLOW_PRIVATE_TARGETS` turns this off (default off).
- **Other protocols**: every WebSocket, gRPC, GraphQL, SSE, TCP, UDP, MQTT and AMQP connection goes through the same address check
  (a `lookup` hook where the library allows it, otherwise the name is resolved once and the connection goes to the checked
  address). Live connections belong to the user who opened them (other users get "not found"), are capped per user and in total
  (`MAX_SESSIONS_PER_USER`, `MAX_SESSIONS_TOTAL`), end after `SESSION_IDLE_MS` without anyone watching, and are closed on sign-out.
  Listening on a local UDP port is off unless the administrator allows ports (`UDP_LISTEN_PORTS`).
- **Scripts**: QuickJS WASM, 1.5 s CPU budget, 32 MB memory, JSON in and out only.
- **XSS**: strict CSP (no inline scripts); the HTML preview is an `<iframe sandbox="" srcdoc>` with no scripts and an opaque origin;
  uploaded avatars are re-validated by magic bytes (PNG/JPEG/WebP only, never SVG).
- **CSRF**: SameSite=Strict cookies plus a required `X-Requested-With` header for cookie-authenticated writes.
- **Sessions**: JWTs carry a per-user version, so a password reset, a password change or disabling an account signs the user
  out everywhere.
- **Injection**: parameterized SQL only; zod validation on every input; sign-in, registration and password change are
  rate-limited. Operators can cap what users may ask for (`MAX_REQUEST_TIMEOUT_MS`, `MAX_RESPONSE_BYTES_LIMIT`).
- **Known limits**: secrets in environments are stored in plain text in SQLite (use disk encryption); there is no server-side
  list of revoked tokens beyond the per-user version.

Found a vulnerability? Please open a private security advisory on the GitHub repository rather than a public issue.

---

## Testing

```bash
npm test      # builds the UI, then runs unit, API and end-to-end tests (node --test)
```

- Unit and API tests need nothing else. The end-to-end tests drive the real UI in headless Chromium and are **skipped** when no
  browser is found; set `CHROME_PATH` to a Chromium/Chrome binary to run them.
- Highlights: roles and permissions, scripting sandbox limits, SSRF guard, import/export round trips, the code snippet
  generators (really executed where the tool is installed), request limits, the viewer rules, every interface language in a
  real browser (including RTL layout), and the dictionaries.
- Every protocol is tested end to end against an in-process server or broker (a WebSocket echo server, a gRPC service, a GraphQL
  server over HTTP and WebSocket, an SSE server, TCP/TLS and UDP sockets, an `aedes` MQTT broker, and a small AMQP 0-9-1 broker built
  on amqplib's frame codec), both through the API and in the browser. Set `AMQP_TEST_URL` to run one more test against a real
  RabbitMQ.
- One test (compiling the generated C code against libcurl) is skipped on machines without the libcurl headers.
- The **Local Agent** is tested as a real process (`tests/agent.test.js`): Host / Origin / CORS / pairing / token checks, target
  rules, Local-mode runs through the server's pipeline, switching modes, the agent stopping and restarting, API errors,
  live sessions, updates and the service files for all three systems. `tests/agent-ui.test.js` does it in the browser.
  `tests/agent-installer.test.js` installs and runs the real Linux standalone program and checks the `.deb` and the other
  installers; it is skipped until `npm run build:installers` has run.

---

## Versioning and releases

The project follows [Semantic Versioning](https://semver.org/) and keeps a [changelog](CHANGELOG.md).

- The single source of truth is `version` in `package.json`. It is shown in **Settings → General → About** and returned by
  `GET /healthz`.
- **From now on every user-visible change updates the version**: patch for fixes, minor for new features, major for breaking
  changes (API, data or configuration). Add an entry to `CHANGELOG.md` under *Unreleased*, and move it under a new version
  heading when releasing.
- To release: `npm version <patch|minor|major> --no-git-tag-version`, update the changelog, commit, then
  `git tag -a vX.Y.Z -m "vX.Y.Z"` and push the tag. A test fails if the changelog does not mention the current version.

Current version: **1.0.0**.

---

## Roadmap

Not yet available: file upload in multipart bodies, inviting people who have no account yet, share-by-link, XML pretty-printing,
a collection runner, mock servers, OpenAPI import, per-secret encryption, gRPC server reflection, and MQTT 5 user properties.
The code is structured so these can be added without rewriting the core: a `protocol` column, one module per live protocol in `core/protocols/` behind the session manager, a runner route on top of
`runner.js` (which already returns test results), and new routes and services reading the same tables.

---

## License and attribution

API Client is open source under the **[Apache License, Version 2.0](LICENSE)**.

Copyright 2026 Hossein Teimouri — source: <https://github.com/HosseinTeimouri79/api-client>

You are free to use, modify, self-host and redistribute this software, including commercially, **provided that you give credit**.
If you use it or build on it you must:

1. **Keep the `LICENSE` and `NOTICE` files** with every copy or derivative you distribute (the Docker image already includes them).
2. **Credit the original author and link to the source** in your documentation or in an "About" / credits screen, for example:

   > Based on **API Client** by Hossein Teimouri — <https://github.com/HosseinTeimouri79/api-client> (Apache License 2.0).

3. **State your changes**: mark modified files as changed, and keep the copyright, patent and attribution notices.

The software is provided "as is", without warranty of any kind. This summary is not legal advice; the full terms are in
[`LICENSE`](LICENSE).
