// Thin fetch wrapper. Cookie auth + custom header (CSRF guard on the server).
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "api-client" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data;
}
export const errorText = (e) =>
  e instanceof ApiError && e.details?.[0]
    ? `${e.details[0].path}: ${e.details[0].message}`
    : (e?.message ?? "Unexpected error");
