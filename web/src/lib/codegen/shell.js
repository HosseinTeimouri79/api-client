import { shq, flatten, join, byteLength } from "./util.js";

const chain = (parts) => parts.join(" \\\n") + "\n";

export function curl(m) {
  const head = m.method === "HEAD" ? " --head" : m.method === "GET" ? "" : ` --request ${m.method}`;
  const globoff = /[{}[\]]/.test(m.url) ? " --globoff" : ""; // curl would treat {{vars}} as URL globs
  const a = [`curl --location${globoff}${head} ${shq(m.url)}`];
  for (const [k, v] of m.headers) a.push(`  --header ${shq(`${k}: ${v}`)}`);
  const b = m.body;
  if (b?.kind === "raw") a.push(`  --data-raw ${shq(b.text)}`);
  else if (b?.kind === "urlencoded") b.fields.forEach(([k, v]) => a.push(`  --data-urlencode ${shq(`${k}=${v}`)}`));
  else if (b?.kind === "multipart") b.fields.forEach(([k, v]) => a.push(`  --form-string ${shq(`${k}=${v}`)}`));
  return chain(a);
}

const httpieKey = (s) => s.replace(/[\\=:@;]/g, (c) => "\\" + c);
export function httpie(m) {
  const form = m.body?.kind === "urlencoded" ? " --form" : m.body?.kind === "multipart" ? " --form --multipart" : "";
  const a = [`http --follow${form} ${m.method} ${shq(m.url)}`];
  for (const [k, v] of m.headers) if (!(form && k.toLowerCase() === "content-type")) a.push(`  ${shq(`${k}:${v}`)}`);
  const b = m.body;
  if (b?.kind === "raw") a.push(`  --raw ${shq(b.text)}`);
  else if (b) b.fields.forEach(([k, v]) => a.push(`  ${shq(`${httpieKey(k)}=${v}`)}`));
  return chain(a);
}

export function wget(m) {
  const { headers, text } = flatten(m);
  const a = ["wget --quiet", `  --method ${m.method}`];
  for (const [k, v] of headers) a.push(`  --header ${shq(`${k}: ${v}`)}`);
  if (text != null) a.push(`  --body-data ${shq(text)}`);
  a.push("  --output-document -", `  ${shq(m.url)}`);
  return chain(a);
}

export function postmanCli(m) {
  const { headers, text } = flatten(m);
  const a = [`postman request ${m.method} ${shq(m.url)}`];
  for (const [k, v] of headers) a.push(`  --header ${shq(`${k}: ${v}`)}`);
  if (text != null) a.push(`  --body ${shq(text)}`);
  return chain(a);
}

export function rawHttp(m) {
  const { headers, text } = flatten(m);
  const hs = [["Host", m.authority], ...headers.filter(([k]) => !["host", "content-length"].includes(k.toLowerCase()))];
  if (text != null) hs.push(["Content-Length", String(byteLength(text))]);
  return `${m.method} ${m.path} HTTP/1.1\n${hs.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${text ?? ""}`;
}
