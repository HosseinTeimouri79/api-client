import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { migrations } from "./migrations.js";

export const uid = () => crypto.randomUUID();
export function openDb(file = config.dbPath) {
  if (file !== ":memory:")
    fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  migrate(db);
  for (const u of config.adminUsernames)
    db.prepare("UPDATE users SET is_admin=1 WHERE username=?").run(u);
  return db;
}
export function migrate(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations(id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT (datetime('now')))",
  );
  const done = new Set(
    db
      .prepare("SELECT id FROM _migrations")
      .all()
      .map((r) => r.id),
  );
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    if (m.fkOff) db.exec("PRAGMA foreign_keys=OFF"); // must be set outside a transaction
    db.exec("BEGIN");
    try {
      if (m.up) m.up(db);
      else db.exec(m.sql);
      db.prepare("INSERT INTO _migrations(id,name) VALUES(?,?)").run(
        m.id,
        m.name,
      );
      if (m.fkOff && db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error(`Migration ${m.id} left dangling foreign keys`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      if (m.fkOff) db.exec("PRAGMA foreign_keys=ON");
    }
  }
}
export const j = (v) => JSON.stringify(v ?? null);
export const parse = (s, d) => {
  try {
    return s == null ? d : JSON.parse(s);
  } catch {
    return d;
  }
};
