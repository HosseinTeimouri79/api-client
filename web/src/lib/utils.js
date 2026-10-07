export const cx = (...a) => a.filter(Boolean).join(" ");
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
export const debounce = (fn, ms = 200) => {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
};
export const initials = (s = "") =>
  s
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
// Stable colour per string (avatars)
export const hue = (s = "") => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const fuzzy = (text, q) => {
  if (!q) return 1;
  const t = text.toLowerCase(),
    n = q.toLowerCase();
  const i = t.indexOf(n);
  if (i >= 0) return 100 - i - (t.length - n.length) / 100;
  let k = 0;
  for (const c of t) if (c === n[k] && ++k === n.length) return 10 - t.length / 100;
  return 0;
};
export function downloadJson(name, data) {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })),
    download: name,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
