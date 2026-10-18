// The protocols a request can speak and the HTTP methods: one list for the server, the Local Agent and the UI (core/shared
// is plain JavaScript that also runs in the browser). HTTP runs once per send (`/run`); the others are live sessions
// (core/sessions.js) driven by one module per protocol in core/protocols.
export const PROTOCOLS = ["http", "websocket", "grpc", "graphql", "sse", "tcp", "udp", "mqtt", "amqp"];
export const IMPLEMENTED = ["http", "websocket", "grpc", "graphql", "sse", "tcp", "udp", "mqtt", "amqp"];
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"];
export const BODYLESS_METHODS = ["GET", "HEAD", "TRACE", "CONNECT"];
