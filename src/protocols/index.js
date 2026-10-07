// Protocols a request can speak. HTTP is request/response (POST /run); the others are connection oriented and run as
// live sessions (see services/sessions.js). Add a protocol: list it here, implement its driver, add its editor in the UI.
export const PROTOCOLS = ["http", "websocket", "grpc", "graphql", "sse", "tcp", "udp", "mqtt", "amqp"];
// The ones that are ready to use; the API refuses to save requests for the others.
export const IMPLEMENTED = ["http"];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"];
// Methods that never carry a body: whatever the editor holds is ignored when sending.
export const BODYLESS_METHODS = ["GET", "HEAD", "TRACE", "CONNECT"];
