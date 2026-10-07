import { encodeQuery } from "./model.js";

export const BOUNDARY = "----ApiClientFormBoundary7MA4YWxkTrZu0gW";
export const join = (...parts) => parts.flat().filter((x) => x !== null && x !== undefined && x !== false).join("\n") + "\n";
export const indent = (s, n = 2) => String(s).split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");
export const ctOf = (m) => m.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
export const withoutCT = (m) => m.headers.filter(([k]) => k.toLowerCase() !== "content-type");
export const isMultiline = (s) => /\n/.test(s);
export const byteLength = (s) => new TextEncoder().encode(s).length;

/** The body as one string, for tools without native form support. Multipart gets a fixed boundary. */
export function flatten(m) {
  const b = m.body;
  if (!b) return { headers: m.headers, text: null };
  if (b.kind === "raw") return { headers: m.headers, text: b.text };
  if (b.kind === "urlencoded") return { headers: m.headers, text: b.fields.map(([k, v]) => `${encodeQuery(k)}=${encodeQuery(v)}`).join("&") };
  const text = b.fields.map(([k, v]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k.replace(/"/g, "%22")}"\r\n\r\n${v}\r\n`).join("") + `--${BOUNDARY}--\r\n`;
  return { headers: [...withoutCT(m), ["Content-Type", `multipart/form-data; boundary=${BOUNDARY}`]], text };
}

// ---- string literals per language ----
export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // POSIX shell
export const dq = (s) => JSON.stringify(String(s)); // double quoted; valid in JS, Python, Go, Java, C#, R
export const kq = (s) => dq(s).replace(/\$/g, "\\$"); // Kotlin ($ starts a template)
export const sq = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; // PHP / Ruby / R / Dart-ish single quotes
export const dartq = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}'`;
export const psq = (s) => `'${String(s).replace(/[\u2018\u2019\u201A\u201B']/g, (c) => c + c)}'`; // PowerShell treats curly quotes as quotes too
const cEscape = (s) => [...String(s)].map((c) => {
  const n = c.codePointAt(0);
  if (c === "\\") return "\\\\";
  if (c === '"') return '\\"';
  if (c === "\n") return "\\n";
  if (c === "\r") return "\\r";
  if (c === "\t") return "\\t";
  return n < 32 || n === 127 ? "\\" + n.toString(8).padStart(3, "0") : c;
}).join("");
export const cq = (s) => `"${cEscape(s)}"`; // C and Objective-C (prefix with @ for NSString)
export const swq = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`)}"`;
export const mlq = (s) => `"${[...String(s)].map((c) => (c === "\\" ? "\\\\" : c === '"' ? '\\"' : c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? "\\" + String(c.charCodeAt(0)).padStart(3, "0") : c)).join("")}"`; // OCaml
export const rustq = (s) => { // raw string with enough #s
  const runs = String(s).match(/"#*/g) ?? [];
  const n = runs.reduce((a, r) => Math.max(a, r.length), 0);
  return `r${"#".repeat(n)}"${s}"${"#".repeat(n)}`;
};
/** JS string literal: template literal for multi-line text (exact), JSON string otherwise. */
export const jsq = (s) => {
  s = String(s);
  return /\n/.test(s) && !/\r/.test(s) ? "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`" : dq(s);
};
export const pyq = (s) => {
  s = String(s);
  if (/\n/.test(s) && !/\r|"$/.test(s)) return '"""' + s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"') + '"""';
  return dq(s);
};
export const goq = (s) => (/\n/.test(s) && !/[`\r]/.test(s) ? "`" + s + "`" : dq(s));
