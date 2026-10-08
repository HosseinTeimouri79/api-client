# Changelog

All notable changes to API Client are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/): **MAJOR** for incompatible changes (API, data or configuration),
**MINOR** for new backwards-compatible features, **PATCH** for bug fixes.

How to release: add the entry below under a new version heading, bump `version` in `package.json`
(`npm version <major|minor|patch> --no-git-tag-version`), commit, then tag (`git tag -a vX.Y.Z -m "vX.Y.Z"`).
The version is shown in **Settings → General → About** and returned by `GET /healthz`.

## [Unreleased]

### Changed
- **Import / Export:** each imported file now reports three lines: **Type** (Collection or Environments, with Postman / Hoppscotch),
  **Count** (environments, or collections and requests) and **File**; a failed file shows the file and the error.
- **Import / Export:** after a successful import the chosen file is cleared and the Import button is inactive again (a file that failed
  stays selected so it can be retried); the same file can be chosen again.
- The **Environments & variables** page is gone. The environment selector in the header now has an edit (pen) and a delete (trash,
  with confirmation) icon on each environment and ends with **New environment…**, which opens one dialog for the name and the
  variables and activates the new environment; view-only members see none of these. The workspace (global) variables moved to
  **⋯ → Workspace (global) variables**. Importing and exporting environments is done in **⋯ → Import / Export**, which already
  handles collections and environments together.
- **New request** no longer asks for a name: a popover lists the protocols and the request is created at once. The sidebar **+**
  button opens the same popover with **New collection** added, so a request of any protocol can be started from there too. On a collection, the separate *new sub-collection* and *new request* buttons are merged into one **+** with the same popover.

## [1.9.0] - 2026-10-08

### Added
- **AMQP 0-9-1** (RabbitMQ and others): Publish (with broker confirmations, properties, headers, mandatory returns), Consume
  (declare, bind, create exchange, prefetch, auto-ack, cancel), Ack, Reject / Requeue and acknowledge-all from the message log.
  Virtual host and credentials from the URL or Settings, TLS, heartbeats.
- This completes the protocol list: HTTP, WebSocket, gRPC, GraphQL, SSE, TCP, UDP, MQTT and AMQP.

## [1.8.0] - 2026-10-08

### Added
- **MQTT** (TCP, TLS and WebSocket): Connect, Publish (QoS 0/1/2, retain, text/base64/hex), Subscribe (wildcards, QoS) and
  Unsubscribe, Disconnect; client ID, credentials, version (3.1, 3.1.1, 5.0), keep-alive, clean session and last will. Incoming
  messages show topic, QoS and retain flag.

### Changed
- **Disconnect** now ends a connection the polite way for each protocol (WebSocket close frame, MQTT DISCONNECT, TCP/UDP close,
  gRPC cancel, GraphQL stop, SSE close) and only drops it if the peer does not react within three seconds.

## [1.7.0] - 2026-10-08

### Added
- **UDP**: Send and Receive datagrams (text, base64 or hex) with the peer address of each one; answers from other sources
  are ignored unless switched off. Optional **listen mode** on a local port, available only for ports the administrator allows
  with the new `UDP_LISTEN_PORTS` setting (off by default).

## [1.6.0] - 2026-10-08

### Added
- **TCP** connections: Connect, Send and Close on a raw socket, plain or TLS (`tcp://`, `tls://`). Text with optional LF / CRLF,
  base64 or hex messages, incoming data grouped into messages, hex dump for binary data, TLS certificate details, options to skip
  verification or set the SNI name, and the response limit applied to the connection.

## [1.5.0] - 2026-10-08

### Added
- **SSE** (Server-Sent Events): stream an endpoint with GET or POST and read events with their names, ids and multi-line data,
  comments and `retry:` hints. Optional reconnect that resumes with `Last-Event-ID`. A standards-based incremental parser
  (any line ending, chunk boundaries anywhere, BOM). Redirects are followed with the address check on every hop.

## [1.4.0] - 2026-10-08

### Added
- **GraphQL** requests: queries and mutations (sent as HTTP, with scripts, tests, history and code snippets) and subscriptions
  (WebSocket, `graphql-transport-ws` and legacy `graphql-ws`). The document is analysed while typing (operation type, syntax
  errors with position, choice between several operations), variables are JSON, queries can use `GET`.
- Schema browser: fetch the schema by introspection and read it as SDL with a filter.
- `POST /workspaces/:wid/graphql/analyze` and `/graphql/introspect`; the editor helpers (`/grpc/describe` too) now live in
  `src/routes/protocolTools.js`.

## [1.3.0] - 2026-10-08

### Added
- **gRPC** requests: unary, server streaming, client streaming and bidirectional calls. Paste a `.proto` (parsed on the server,
  Google's well-known types built in), pick a service and method, edit the JSON message (an example is generated), send
  messages on streaming calls, end or cancel them. Metadata, deadline, TLS (with an option for self-signed test servers),
  response headers, trailers and the final status are shown.
- `POST /workspaces/:wid/grpc/describe` lists the services and methods of a `.proto`.
- The address a gRPC connection uses is the one the SSRF guard checked.

## [1.2.0] - 2026-10-08

### Added
- **WebSocket** requests: Connect, Send (text, base64 or hex), Ping, Pong and Close, with subprotocols, headers, auth,
  variables and a live log of events, messages and the handshake.
- Live sessions: a protocol-independent session manager (event log with replay over Server-Sent Events, per-user and global
  limits, idle timeout), used by WebSocket and by the protocols that follow. API: `/workspaces/:wid/sessions`.
- Protocol picker next to the URL; the sidebar and tabs show the protocol instead of a method for live protocols.
- Settings for the operator: `MAX_SESSIONS_PER_USER`, `MAX_SESSIONS_TOTAL`, `SESSION_IDLE_MS`, `SESSION_EVENT_LIMIT`.

## [1.1.0] - 2026-10-08

First step of multi-protocol support.

### Added
- HTTP `TRACE` and `CONNECT` methods. Both are sent without a body; for `CONNECT` the URL is the proxy and the tunnel
  target is the URL path (or the URL's host:port), and the proxy's reply is reported.
- Every request now has a `protocol` and free-form `protocol_data` (migration 9). Only `http` is accepted for now; the list of
  planned protocols lives in `src/protocols/index.js`.

### Changed
- Postman / Hoppscotch export leaves non-HTTP requests out and says so in the warnings.

## [1.0.0] - 2026-10-08

First versioned release.

### Workspace and requests
- Workspaces with role-based sharing (owner, admin, editor, viewer), member picker, audit log.
- Collections and sub-collections (drag and drop, duplicate, sort, move to root), descriptions, variables, auth and scripts
  inherited by everything inside.
- Requests with all common methods and body types (JSON, text, raw, form URL-encoded, multipart text fields), query params,
  headers, Bearer / Basic / API-key auth with inheritance.
- Environments and five-level variable scopes (runtime > request > collection > environment > workspace).
- Sandboxed pre-request and post-request scripts (QuickJS/WASM) with a Postman-compatible `pm.*` API, tests and assertions.
- Response viewer (JSON tree, search, raw, sandboxed HTML preview, headers, sent request, binary download), console, history.
- Code snippets in 35 language/library targets (cURL by default).
- View-only members can edit and run a request locally without being able to save it.

### Import and export
- Import and export of Postman (collections v2.1, environments) and Hoppscotch (collections, environments) files, one
  environment at a time for exports, with notes about anything that cannot be converted.

### Accounts and administration
- Username and password sign-in, profile photo, profile editing, password change.
- Admin panel: users (create, edit, reset password, disable, delete), workspaces, activity, and a switch that turns
  self-registration off so only admins can create accounts. The first account becomes the administrator.
- App settings stored on the account: request timeout and maximum response size, console and layout, editor font,
  indentation and auto-close, theme, language, app font, autosave.

### Interface
- 15 languages (en-US, es-ES, zh-CN, de-DE, fr-FR, ja-JP, pt-BR, ko-KR, hi-IN, it-IT, id-ID, tr-TR, ar-SA, ru-RU, fa-IR)
  with a flag + name picker; the whole layout mirrors for Arabic and Persian.

### Operations
- Docker image (non-root, read-only root filesystem), SQLite with automatic versioned migrations, health check.
- Licensed under the Apache License 2.0; see `LICENSE` and `NOTICE`.

[Unreleased]: https://github.com/HosseinTeimouri79/api-client/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/HosseinTeimouri79/api-client/releases/tag/v1.0.0
