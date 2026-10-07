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
  {
    // Login is by username + password. `email` is kept as a nullable legacy column (no longer used or required);
    // existing accounts get their username from the local part of their email (made unique).
    // users is rebuilt (SQLite cannot drop NOT NULL/UNIQUE), so this runs with foreign keys off.
    id: 2,
    name: "username-login",
    fkOff: true,
    up(db) {
      const taken = new Set();
      const pick = (email, id) => {
        let base = String(email ?? "")
          .split("@")[0]
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, "_")
          .slice(0, 28);
        if (base.length < 3) base = (base + "user").slice(0, 28);
        let u = base,
          n = 1;
        while (taken.has(u)) u = `${base}${++n}`;
        taken.add(u);
        return u;
      };
      db.exec(
        "CREATE TABLE users_new(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, email TEXT, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
      );
      const ins = db.prepare(
        "INSERT INTO users_new(id,username,name,email,password_hash,created_at) VALUES(?,?,?,?,?,?)",
      );
      for (const u of db.prepare("SELECT * FROM users ORDER BY created_at, rowid").all())
        ins.run(u.id, pick(u.email, u.id), u.name, u.email, u.password_hash, u.created_at);
      db.exec("DROP TABLE users; ALTER TABLE users_new RENAME TO users");
    },
  },
];
