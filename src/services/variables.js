// Variable resolution. Precedence (highest first): runtime > request > collection (nearest first) > environment > workspace.
const RE = /\{\{\s*([\w.\-]+)\s*\}\}/g;
export const toMap = (list = []) =>
  Object.fromEntries(
    list
      .filter((v) => v.key && v.enabled !== false)
      .map((v) => [v.key, String(v.value ?? "")]),
  );

export function mergeScopes({
  workspace = [],
  environment = [],
  collections = [],
  request = [],
  runtime = {},
}) {
  // collections: ordered root -> leaf, so later (nearer) entries override
  const out = { ...toMap(workspace), ...toMap(environment) };
  for (const c of collections) Object.assign(out, toMap(c));
  Object.assign(out, toMap(request), runtime);
  return out;
}
export function resolve(str, vars) {
  if (typeof str !== "string") return str;
  let cur = str;
  for (let i = 0; i < 5; i++) {
    // allow nested refs, bounded to avoid cycles
    const next = cur.replace(RE, (m, k) => (k in vars ? vars[k] : m));
    if (next === cur) break;
    cur = next;
  }
  return cur;
}
export const resolveDeep = (v, vars) =>
  typeof v === "string"
    ? resolve(v, vars)
    : Array.isArray(v)
      ? v.map((x) => resolveDeep(x, vars))
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).map(([k, x]) => [k, resolveDeep(x, vars)]),
          )
        : v;
