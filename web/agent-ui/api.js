// The agent's page API (agent/src/ui.js), same origin, with the session cookie.
export class UiError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    Object.assign(this, extra);
  }
}
export async function ui(method, path, body) {
  let res;
  try {
    res = await fetch(`/ui/api${path}`, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new UiError(0, "unreachable");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  return data;
}
