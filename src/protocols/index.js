// The protocols a request can speak. HTTP runs once per send (`/run`); the others are live sessions
// (src/services/sessions.js) driven by one module per protocol in this folder.
export const PROTOCOLS = ["http", "websocket", "grpc", "graphql", "sse", "tcp", "udp", "mqtt", "amqp"];
export const IMPLEMENTED = ["http", "websocket", "grpc", "graphql", "sse", "tcp", "udp"];
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"];
export const BODYLESS_METHODS = ["GET", "HEAD", "TRACE", "CONNECT"];
