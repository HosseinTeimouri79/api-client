import dns from "node:dns";
import net from "node:net";
import { config } from "../config.js";

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
  return (
    l === "::1" ||
    l === "::" ||
    l.startsWith("fc") ||
    l.startsWith("fd") ||
    l.startsWith("fe8") ||
    l.startsWith("fe9") ||
    l.startsWith("fea") ||
    l.startsWith("feb")
  );
}
// http(s).request `lookup` hook: validates the *connected* IP, so DNS-rebinding can't bypass the check.
export function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs.filter(
      (a) => config.allowPrivateTargets || !isPrivateIp(a.address),
    );
    if (!list.length)
      return cb(
        Object.assign(
          new Error(
            `Blocked: ${hostname} resolves to a private/internal address (SSRF protection)`,
          ),
          { code: "SSRF_BLOCKED" },
        ),
      );
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

// http.request skips `lookup` for IP-literal hosts, so literals must be validated explicitly.
export function assertPublicHost(urlStr) {
  const host = new URL(urlStr).hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !config.allowPrivateTargets && isPrivateIp(host))
    throw Object.assign(
      new Error(
        `Blocked: ${host} is a private/internal address (SSRF protection)`,
      ),
      { code: "SSRF_BLOCKED" },
    );
}

// For clients that cannot take a `lookup` hook (gRPC): resolves the name once, checks every address and returns the one to
// connect to, so the connection goes to exactly the address that was validated.
export async function resolvePublicAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!config.allowPrivateTargets && isPrivateIp(host))
      throw Object.assign(new Error(`Blocked: ${host} is a private/internal address (SSRF protection)`), { code: "SSRF_BLOCKED" });
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  const addrs = await dns.promises.lookup(host, { all: true });
  const ok = addrs.filter((a) => config.allowPrivateTargets || !isPrivateIp(a.address));
  if (!ok.length)
    throw Object.assign(new Error(`Blocked: ${host} resolves to a private/internal address (SSRF protection)`), { code: "SSRF_BLOCKED" });
  return ok[0];
}
