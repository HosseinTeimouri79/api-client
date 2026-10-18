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

// Which addresses may be connected to. The server's rule is "public addresses only, unless ALLOW_PRIVATE_TARGETS";
// the Local Agent (agent/) runs the same code with its own rule (`setAddressPolicy`). A policy answers null when
// (ip, hostname) is allowed, or the reason it is not.
const serverPolicy = (ip) =>
  config.allowPrivateTargets || !isPrivateIp(ip) ? null : "private/internal address (SSRF protection)";
let policy = serverPolicy;
export const setAddressPolicy = (fn) => { policy = fn ?? serverPolicy; };
const blocked = (hostname, ip, reason, literal) =>
  Object.assign(
    new Error(
      policy === serverPolicy
        ? `Blocked: ${hostname} ${literal ? "is" : "resolves to"} a ${reason}`
        : `Blocked: ${hostname}${literal ? "" : ` (${ip})`}: ${reason}`,
    ),
    { code: "SSRF_BLOCKED" },
  );

// http(s).request `lookup` hook: validates the *connected* IP, so DNS-rebinding can't bypass the check.
export function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const reasons = addrs.map((a) => policy(a.address, hostname));
    const list = addrs.filter((_, i) => !reasons[i]);
    if (!list.length) return cb(blocked(hostname, addrs[0]?.address, reasons[0], false));
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

// http.request skips `lookup` for IP-literal hosts, so literals must be validated explicitly.
export function assertPublicHost(urlStr) {
  const host = new URL(urlStr).hostname.replace(/^\[|\]$/g, "");
  const reason = net.isIP(host) ? policy(host, host) : null;
  if (reason) throw blocked(host, host, reason, true);
}

// For clients that cannot take a `lookup` hook (gRPC): resolves the name once, checks every address and returns the one to
// connect to, so the connection goes to exactly the address that was validated.
export async function resolvePublicAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    const reason = policy(host, host);
    if (reason) throw blocked(host, host, reason, true);
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  const addrs = await dns.promises.lookup(host, { all: true });
  const reasons = addrs.map((a) => policy(a.address, host));
  const ok = addrs.filter((_, i) => !reasons[i]);
  if (!ok.length) throw blocked(host, addrs[0]?.address, reasons[0], false);
  return ok[0];
}
