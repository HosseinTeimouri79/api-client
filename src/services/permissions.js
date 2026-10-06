// Role-based permissions. Single source of truth; enforced server-side in middleware.
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
export const PERMS = {
  "workspace:read": "viewer",
  "request:run": "viewer",
  "content:write": "editor", // collections, requests, scripts, environments
  "members:manage": "admin",
  "workspace:update": "admin",
  "workspace:delete": "owner",
};
export const ROLES = Object.keys(ROLE_RANK);
export const can = (role, perm) =>
  !!role && ROLE_RANK[role] >= ROLE_RANK[PERMS[perm]];
export const outranks = (a, b) => ROLE_RANK[a] > ROLE_RANK[b];
