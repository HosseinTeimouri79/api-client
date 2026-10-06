import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { safeLookup, assertPublicHost } from "./ssrf.js";
import { config } from "../config.js";

const SIZE_MAX = config.maxResponseBytes;
const active = (list = []) => list.filter((x) => x.key && x.enabled !== false);

export function applyAuth(auth, headers, url) {
  if (!auth || auth.type === "none" || !auth.type) return;
  if (auth.type === "bearer")
    headers["Authorization"] = `Bearer ${auth.token ?? ""}`;
  else if (auth.type === "basic")
    headers["Authorization"] =
      "Basic " +
      Buffer.from(`${auth.username ?? ""}:${auth.password ?? ""}`).toString(
        "base64",
      );
  else if (auth.type === "apikey") {
    if (auth.in === "query") url.searchParams.set(auth.key, auth.value ?? "");
    else headers[auth.key] = auth.value ?? "";
  }
}
// Pure builder: (already-resolved request) -> { url, method, headers, body }
export async function buildRequest(r, inheritedAuth) {
  let url;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(r.url) ? r.url : "http://" + r.url,
    );
  } catch {
    throw new Error(`Invalid URL: ${r.url}`);
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only http and https are supported");
  for (const p of active(r.params))
    url.searchParams.append(p.key, p.value ?? "");
  const headers = {};
  for (const h of active(r.headers)) headers[h.key] = h.value ?? "";
  const has = (n) => Object.keys(headers).some((k) => k.toLowerCase() === n);
  applyAuth(
    r.auth?.type && r.auth.type !== "inherit" ? r.auth : inheritedAuth,
    headers,
    url,
  );
  const b = r.body ?? { mode: "none" };
  let body;
  const noBody = ["GET", "HEAD"].includes(r.method);
  if (!noBody)
    switch (b.mode) {
      case "json":
        body = b.content ?? "";
        if (b.content) {
          try {
            JSON.parse(b.content);
          } catch (e) {
            throw new Error("Invalid JSON body: " + e.message);
          }
        }
        if (!has("content-type")) headers["Content-Type"] = "application/json";
        break;
      case "text":
        body = b.content ?? "";
        if (!has("content-type")) headers["Content-Type"] = "text/plain";
        break;
      case "raw":
        body = b.content ?? "";
        break;
      case "urlencoded":
        body = new URLSearchParams(
          active(b.fields).map((f) => [f.key, f.value ?? ""]),
        ).toString();
        if (!has("content-type"))
          headers["Content-Type"] = "application/x-www-form-urlencoded";
        break;
      case "multipart": {
        const fd = new FormData();
        for (const f of active(b.fields)) fd.append(f.key, f.value ?? "");
        const resp = new Response(fd);
        headers["Content-Type"] = resp.headers.get("content-type");
        body = Buffer.from(await resp.arrayBuffer());
        break;
      }
    }
  if (body != null) headers["Content-Length"] = String(Buffer.byteLength(body));
  return { url: url.toString(), method: r.method, headers, body };
}

function once({ url, method, headers, body }, signal) {
  return new Promise((resolve, reject) => {
    assertPublicHost(url);
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      {
        method,
        headers: {
          "Accept-Encoding": "gzip, deflate, br",
          "User-Agent": "api-client/1.0",
          ...headers,
        },
        lookup: safeLookup,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: config.connectAttemptTimeoutMs,
        signal,
        timeout: config.requestTimeoutMs,
      },
      (res) => {
        const enc = res.headers["content-encoding"];
        const stream =
          enc === "gzip"
            ? res.pipe(zlib.createGunzip())
            : enc === "br"
              ? res.pipe(zlib.createBrotliDecompress())
              : enc === "deflate"
                ? res.pipe(zlib.createInflate())
                : res;
        const chunks = [];
        let size = 0;
        stream.on("data", (c) => {
          size += c.length;
          if (size > SIZE_MAX) {
            req.destroy(new Error(`Response exceeds ${SIZE_MAX} bytes`));
          } else chunks.push(c);
        });
        stream.on("end", () => resolve({ res, buf: Buffer.concat(chunks) }));
        stream.on("error", reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(
        Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }),
      ),
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}
// Executes with manual redirect following so every hop passes the SSRF check.
export async function execute(built, { maxRedirects = 5 } = {}) {
  const t0 = performance.now();
  let cur = built;
  const hops = [];
  for (let i = 0; i <= maxRedirects; i++) {
    const { res, buf } = await once(cur);
    const loc = res.headers.location;
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
      hops.push(cur.url);
      const next = new URL(loc, cur.url).toString();
      const toGet =
        res.statusCode === 303 ||
        ((res.statusCode === 301 || res.statusCode === 302) &&
          cur.method === "POST");
      const h = { ...cur.headers };
      delete h["Content-Length"];
      if (new URL(next).origin !== new URL(cur.url).origin) {
        delete h["Authorization"];
        delete h["authorization"];
        delete h["Cookie"];
      }
      cur = toGet
        ? { url: next, method: "GET", headers: h }
        : { ...cur, url: next, headers: cur.headers };
      continue;
    }
    const ct = String(res.headers["content-type"] || "");
    const text = /json|text|xml|html|javascript|urlencoded/i.test(ct) || !ct;
    const isBin = !text && buf.length > 0 && buf.includes(0);
    return {
      status: res.statusCode,
      statusText: res.statusMessage,
      durationMs: Math.round(performance.now() - t0),
      size: buf.length,
      headers: Object.entries(res.headers).map(([key, value]) => ({
        key,
        value: Array.isArray(value) ? value.join(", ") : String(value),
      })),
      contentType: ct,
      redirects: hops,
      binary: isBin,
      body: isBin ? buf.toString("base64") : buf.toString("utf8"),
    };
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}
