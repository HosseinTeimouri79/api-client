export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const HEADER_NAMES = {
  Accept: "Media types the client understands",
  "Accept-Encoding": "Compression the client supports",
  "Accept-Language": "Preferred languages",
  Authorization: "Credentials for the server",
  "Cache-Control": "Caching directives",
  Connection: "Connection options",
  "Content-Type": "Media type of the body",
  "Content-Length": "Size of the body in bytes",
  Cookie: "Stored cookies",
  Host: "Target host",
  Origin: "Origin of the request",
  Referer: "Previous page URL",
  "User-Agent": "Client identification",
  "If-None-Match": "Conditional request (ETag)",
  "If-Modified-Since": "Conditional request (date)",
  "X-API-Key": "Common API-key header",
  "X-Requested-With": "Marks AJAX requests",
  "X-Request-Id": "Correlation id",
  "X-Forwarded-For": "Original client address",
};
export const HEADER_VALUES = {
  "content-type": ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain", "text/html", "application/xml", "application/octet-stream"],
  accept: ["application/json", "text/html", "*/*", "application/xml", "text/plain"],
  "accept-encoding": ["gzip, deflate, br", "identity"],
  "cache-control": ["no-cache", "no-store", "max-age=0"],
  connection: ["keep-alive", "close"],
  authorization: ["Bearer {{token}}", "Basic "],
};
export const statusColor = (s) =>
  s >= 500 ? "var(--err)" : s >= 400 ? "var(--warn)" : s >= 300 ? "var(--accent)" : "var(--ok)";
export const blankReq = () => ({
  name: "New Request",
  description: "",
  method: "GET",
  url: "",
  params: [],
  headers: [],
  body: { mode: "none" },
  auth: { type: "inherit" },
  variables: [],
  pre_script: "",
  post_script: "",
});
const nonBlank = (l = []) => l.filter((x) => x.key || x.value);
export const cleanReq = (r) => ({
  ...r,
  params: nonBlank(r.params),
  headers: nonBlank(r.headers),
  variables: nonBlank(r.variables),
  body: r.body?.fields ? { ...r.body, fields: nonBlank(r.body.fields) } : r.body,
});
