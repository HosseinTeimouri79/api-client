// Thin fetch wrapper. Cookie auth + custom header (CSRF guard on the server).
import { t } from "./i18n/index.js";

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
// The server answers in English; the messages users meet most are shown in their language.
const SERVER_ERRORS = {
  "Admin access required": "err.adminRequired", "Already a member": "err.alreadyMember", "Authentication required": "err.authRequired",
  "Collection not found": "err.collectionNotFound", "CSRF check failed": "err.csrf", "Current password is incorrect": "err.badCurrentPassword",
  "Environment not found": "err.envNotFound", "Insufficient permissions": "err.forbidden", "Insufficient permissions for this role change": "err.roleChange",
  "Invalid or expired token": "err.expiredToken", "Invalid username or password": "err.badLogin", "Member not found": "err.memberNotFound",
  "Not found": "err.notFound", "Owner cannot be removed": "err.ownerRemove", "Owner role cannot be changed": "err.ownerRole",
  "Request not found": "err.requestNotFound", "This account is disabled": "err.accountDisabled", "Username already taken": "err.usernameTaken",
  "User not found": "err.userNotFound", "Workspace not found": "err.workspaceNotFound", "You cannot change your own role": "err.ownRole",
  "You can't delete your own account": "err.deleteSelf", "You can't remove your own admin access or disable your own account": "err.lockout",
  "Payload too large": "err.tooLarge", "Malformed JSON": "err.malformed", "Internal server error": "err.internal", "Validation failed": "err.validation",
  "Not a valid PNG, JPEG or WebP image": "err.badImage", "Send a PNG, JPEG or WebP image": "err.badImage",
  "Registration is disabled. Ask an administrator to create your account": "err.registrationClosed",
  "Only the owner can grant admin; ownership is not grantable": "err.grantAdmin",
  "Postman files hold a single collection: pick one collection to export": "err.postmanSingle",
  "Collection nesting is too deep": "err.nestingTooDeep", "Cannot move a collection into itself or its descendants": "err.moveIntoSelf",
};
export const localizeServerError = (msg) => (SERVER_ERRORS[msg] ? t(SERVER_ERRORS[msg]) : msg);

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: { "Content-Type": body instanceof Blob ? body.type : "application/json", "X-Requested-With": "api-client" },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, t("err.network"));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(res.status, data?.error ? localizeServerError(data.error) : t("err.requestFailed", { status: res.status }), data?.details);
  return data;
}
export const errorText = (e) =>
  e instanceof ApiError && e.details?.[0]
    ? `${e.details[0].path}: ${e.details[0].message}`
    : (e?.message ?? t("err.unexpected"));
