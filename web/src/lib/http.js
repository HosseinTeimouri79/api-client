export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"];
// header name -> i18n key of its description
export const HEADER_NAMES = {
  Accept: "hdr.acceptTypes",
  "Accept-Encoding": "hdr.acceptEncoding",
  "Accept-Language": "hdr.acceptLanguage",
  Authorization: "hdr.authorization",
  "Cache-Control": "hdr.cacheControl",
  Connection: "hdr.connection",
  "Content-Type": "hdr.contentType",
  "Content-Length": "hdr.contentLength",
  Cookie: "hdr.cookie",
  Host: "hdr.host",
  Origin: "hdr.origin",
  Referer: "hdr.referer",
  "User-Agent": "hdr.userAgent",
  "If-None-Match": "hdr.ifNoneMatch",
  "If-Modified-Since": "hdr.ifModifiedSince",
  "X-API-Key": "hdr.apiKey",
  "X-Requested-With": "hdr.requestedWith",
  "X-Request-Id": "hdr.requestId",
  "X-Forwarded-For": "hdr.forwardedFor",
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
  protocol: "http",
  protocol_data: {},
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
