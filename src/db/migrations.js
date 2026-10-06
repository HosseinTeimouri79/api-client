// Ordered, append-only migrations. Never edit an applied migration; add a new one.
export const migrations = [
  {
    id: 1,
    name: "init",
    sql: `
    CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), variables TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE workspace_members(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')), PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE collections(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, variables TEXT NOT NULL DEFAULT '[]', auth TEXT, pre_script TEXT NOT NULL DEFAULT '', post_script TEXT NOT NULL DEFAULT '');
    CREATE INDEX idx_col_ws ON collections(workspace_id,parent_id);
    CREATE TABLE requests(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, method TEXT NOT NULL DEFAULT 'GET', url TEXT NOT NULL DEFAULT '', params TEXT NOT NULL DEFAULT '[]', headers TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '{"mode":"none"}', auth TEXT, variables TEXT NOT NULL DEFAULT '[]', pre_script TEXT NOT NULL DEFAULT '', post_script TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX idx_req_col ON requests(collection_id);
    CREATE TABLE environments(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, variables TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE history(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, method TEXT, url TEXT, status INTEGER, duration_ms INTEGER, snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX idx_hist_user ON history(user_id,workspace_id,created_at);
    CREATE TABLE audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT, user_id TEXT, action TEXT NOT NULL, target TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `,
  },
];
