import net from "node:net";

/**
 * Which addresses the agent may send requests to. Unlike the server (public addresses only), the agent exists to
 * reach the user's own machine and network, so loopback and private ranges are allowed by default; link-local addresses
 * (169.254.0.0/16, fe80::/10, which include cloud metadata endpoints) are not.
 */
const METADATA = new Set(["169.254.169.254", "169.254.170.2", "fd00:ec2::254", "100.100.100.200"]);

/** loopback | private | linkLocal | public | unspecified */
export function classify(ip) {
  let a = ip.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) a = mapped[1];
  if (METADATA.has(a)) return "linkLocal";
  if (net.isIPv4(a)) {
    const [x, y] = a.split(".").map(Number);
    if (x === 0) return "unspecified";
    if (x === 127) return "loopback";
    if (x === 169 && y === 254) return "linkLocal";
    if (x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224) return "private";
    return "public";
  }
  if (a === "::") return "unspecified";
  if (a === "::1") return "loopback";
  if (/^fe[89ab]/.test(a)) return "linkLocal";
  if (/^f[cd]/.test(a) || a.startsWith("ff")) return "private";
  return "public";
}

const LABEL = { loopback: "this computer (loopback)", private: "a private network address", linkLocal: "a link-local / cloud metadata address", public: "a public address", unspecified: "an unspecified address" };

// "10.0.0.0/8", "192.168.1.20", "fd00::/8" -> BlockList; anything else is a host name pattern ("*.corp.local", "localhost").
function compile(list = []) {
  const ips = new net.BlockList();
  const hosts = [];
  for (const raw of list) {
    const e = String(raw).trim().toLowerCase();
    if (!e) continue;
    const [addr, bits] = e.split("/");
    const fam = net.isIPv4(addr) ? "ipv4" : net.isIPv6(addr) ? "ipv6" : null;
    if (fam && bits !== undefined) ips.addSubnet(addr, Number(bits), fam);
    else if (fam) ips.addAddress(addr, fam);
    else hosts.push(new RegExp("^" + e.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+(?:\\.[^.]+)*") + "$"));
  }
  const ipHit = (ip) => {
    const a = ip.replace(/^::ffff:(?=\d+\.)/i, "");
    return ips.check(a, net.isIPv6(a) ? "ipv6" : "ipv4");
  };
  return { empty: !list.filter((x) => String(x).trim()).length, has: (ip, host) => ipHit(ip) || hosts.some((h) => h.test(String(host ?? "").toLowerCase())) };
}

/** (ip, hostname) -> null when allowed, otherwise the reason (for ssrf.setAddressPolicy). */
export function makeAddressPolicy(targets = {}) {
  const t = { public: true, private: true, loopback: true, linkLocal: false, ...targets };
  const allow = compile(t.allow), deny = compile(t.deny);
  return (ip, hostname) => {
    if (deny.has(ip, hostname)) return "denied by the Local Agent's target rules (targets.deny)";
    if (!allow.empty && !allow.has(ip, hostname)) return "not in the Local Agent's allowed targets (targets.allow)";
    const kind = classify(ip);
    if (kind === "unspecified") return "an unspecified address is never a valid target";
    if (!t[kind]) return `${LABEL[kind]}, which the Local Agent does not allow (targets.${kind})`;
    return null;
  };
}

/** An entry of targets.allow / targets.deny: an IP, a CIDR range or a host name pattern such as "*.corp.local". */
export function validTarget(raw) {
  const e = String(raw ?? "").trim().toLowerCase();
  if (!e || e.length > 253) return false;
  const [addr, bits, extra] = e.split("/");
  if (extra !== undefined) return false;
  const fam = net.isIPv4(addr) ? 32 : net.isIPv6(addr) ? 128 : 0;
  if (fam) return bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= fam);
  const label = "(?:\\*|[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)";
  return bits === undefined && new RegExp(`^${label}(?:\\.${label})*$`).test(e);
}
