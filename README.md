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
6. [Configuration](#configuration)
7. [Using the app](#using-the-app)
8. [Import and export (Postman and Hoppscotch)](#import-and-export-postman-and-hoppscotch)
9. [Scripting](#scripting)
10. [Code snippets](#code-snippets)
11. [Languages](#languages)
12. [Accounts, roles and administration](#accounts-roles-and-administration)
13. [HTTP API](#http-api)
14. [Architecture](#architecture)
15. [Security](#security)
16. [Testing](#testing)
17. [Versioning and releases](#versioning-and-releases)
18. [Roadmap](#roadmap)
19. [License and attribution](#license-and-attribution)

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
| `CHROME_PATH`                 | auto-detected          | Chromium/Chrome binary for the end-to-end tests.                                                |

**Per-user limits.** Each user can set a request timeout and maximum response size under **Settings → General → Request**.
A value of `0` means "as much as the server allows", i.e. the two ceilings above. Operators who want no ceiling at all can set
a ceiling to `0`.

**Database and migrations.** Migrations run automatically at start (`src/db/migrations.js`). They are append-only,
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
  (collections only), then **Import**. The empty sidebar also has an **Import** button next to **New collection**.
- **Environments & variables → Import**: Postman or Hoppscotch environment files, several at once.

Anything that cannot be converted is listed as a **note** after the import instead of failing silently. You need the editor
role (or higher) to import.

### How to export

- Collection context menu (**⋯ → Export as Postman / Export as Hoppscotch**).
- **Import / Export → Export**: pick the format and *what to export* (a collection, all top-level collections — Hoppscotch only —
  or one environment).
- **Environments & variables → Export**: the selected environment as Postman or Hoppscotch.

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
| Database      | SQLite (`node:sqlite`, WAL, foreign keys on) + versioned migrations           | zero ops, single file, no native build; the data layer is isolated in `src/db`               |
| Auth          | username + password (bcrypt), JWT in an httpOnly SameSite=Strict cookie or Bearer | CSRF-resistant (custom header required for cookie auth)                                  |
| Script engine | QuickJS compiled to WASM (`quickjs-emscripten`)                               | a real sandbox: no fs/net/process, CPU and memory limits                                     |
| Frontend      | React 19 + Vite + zustand (`web/`, built to `dist/`)                          | in-house component library (no UI kit); React escapes by default; Vite is build-time only    |

### Layout

```
src/
  app.js server.js config.js
  db/            index.js (open + migrate)  migrations.js (append-only)
  middleware/    auth.js (authenticate, csrfGuard, requireWorkspace, requireAdmin, audit)
  routes/        auth.js me.js admin.js workspaces.js content.js interop.js sessions.js protocolTools.js
  services/      permissions.js variables.js executor.js runner.js scriptEngine.js ssrf.js sessions.js
  protocols/     index.js (protocol list) common.js websocket.js grpc.js graphql.js sse.js tcp.js udp.js mqtt.js amqp.js (one module per protocol)
                 interop.js (Postman/Hoppscotch) settings.js userSettings.js locales.js
web/             index.html vite.config.js
  src/           main.jsx App.jsx store.js api.js
    components/  ui (AutoComplete Select Popover Menu Modal Toasts Splitter Flag LanguageSelect …)
                 editor (VarInput CodeEditor KeyValueEditor BodyEditor AuthEditor ScriptEditor)
                 response (ResponseViewer JsonTree)
    features/    TopBar Sidebar RequestEditor RequestTabs Console CodeSnippet SettingsPage AdminPanel + dialogs
    lib/         codegen (35 snippet targets) settings http snippets …
    i18n/        index.js locales.js locales/<code>.js
dist/            build output served by Express (npm run build)
tests/           unit, API and end-to-end tests
```

### Data model

`users` (unique username, `is_admin`, `disabled`, `token_version`, avatar, `locale`, `settings`) · `workspaces` (variables) ·
`workspace_members` (role) · `collections` (parent tree, description, variables, auth, pre/post scripts) · `requests` (protocol, protocol data, method,
url, params, headers, body, auth, variables, scripts, description) · `environments` · `history` (per user) · `audit_log` ·
`settings` (instance settings such as registration) · `_migrations`.

Migrations: 1 initial schema · 2 username login · 3 admin panel (admin/disabled/token version) · 4 profile (avatar, locale) ·
5 instance settings · 6 collection description · 7 per-user settings · 8 full locale codes.

### Request pipeline (`services/runner.js`)

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

Workspace roles are `owner > admin > editor > viewer`; `services/permissions.js` is the single permission table, and
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
- **React + Vite, in-house components.** Keeps the dependency surface small; the production image only ships `dist/`.
- **Username login.** Email was never verified or used, so it was dropped.
- **Dictionaries, not hard-coded text.** All UI text lives in `web/src/i18n/locales`; a test fails when a component hard-codes
  user-facing text.

---

## Security

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
The code is structured so these can be added without rewriting the core: a `protocol` column, one module per live protocol in `src/protocols/` behind the session manager, a runner route on top of
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
