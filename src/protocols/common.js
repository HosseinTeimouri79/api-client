import { applyAuth } from "../services/executor.js";
import { assertPublicHost } from "../services/ssrf.js";

const active = (list = []) => list.filter((x) => x.key && x.enabled !== false);

/**
 * Parses what the user typed as the address: adds the default scheme, maps the accepted schemes to the one to connect
 * with (`schemes`), and refuses private targets (SSRF) like HTTP runs do.
 */
export function parseEndpoint(raw, { schemes, defaultScheme, needPort = false }) {
  raw = String(raw ?? "").trim();
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${defaultScheme}://${raw}`);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  const scheme = schemes[url.protocol.slice(0, -1)];
  if (!scheme) throw new Error(`Unsupported scheme "${url.protocol.slice(0, -1)}" (use ${Object.keys(schemes).join(", ")})`);
  if (!url.hostname) throw new Error(`Invalid URL: ${raw}`);
  if (scheme !== url.protocol.slice(0, -1)) {
    // URL refuses to change between "special" and other schemes via .protocol, so rebuild it
    url = new URL(`${scheme}://${url.host}${url.pathname}${url.search}${url.hash}`);
  }
  if (needPort && !url.port) throw new Error(`The address needs a port, e.g. ${scheme}://${url.hostname}:9000`);
  assertPublicHost(url.toString());
  return url;
}

/** An (already variable-resolved) request as a URL plus headers: adds query params, headers and auth. */
export function prepareTarget(r, inheritedAuth, opts) {
  const url = parseEndpoint(r.url, opts);
  for (const p of active(r.params)) url.searchParams.append(p.key, p.value ?? "");
  const headers = {};
  for (const h of active(r.headers)) headers[h.key] = h.value ?? "";
  applyAuth(r.auth?.type && r.auth.type !== "inherit" ? r.auth : inheritedAuth, headers, url);
  return { url, headers };
}

/** Decodes a message typed in the UI: plain text, or base64 / hex for binary payloads. */
export function decodePayload(data, format = "text") {
  const s = String(data ?? "");
  if (format === "base64") {
    if (!/^[\sA-Za-z0-9+/_-]*={0,2}\s*$/.test(s)) throw new Error("Payload is not valid base64");
    return Buffer.from(s, "base64");
  }
  if (format === "hex") {
    const h = s.replace(/[\s:]|0x/gi, "");
    if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error("Payload is not valid hex");
    return Buffer.from(h, "hex");
  }
  return Buffer.from(s, "utf8");
}

/** How a received buffer is shown: text when it is valid UTF-8 without control junk, base64 otherwise. */
export function describePayload(buf) {
  const binary = !isUtf8(buf);
  return { binary, size: buf.length, data: binary ? buf.toString("base64") : buf.toString("utf8") };
}
function isUtf8(buf) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return !buf.includes(0);
  } catch {
    return false;
  }
}
