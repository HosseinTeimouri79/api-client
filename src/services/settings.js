// Instance-wide settings stored in the `settings` table; admins edit them in the admin panel.
// Registration is open unless an admin turned it off, so existing installs keep working.
export const registrationOpen = (db) =>
  db.prepare("SELECT value FROM settings WHERE key='registration_open'").get()?.value !== "false";
export const setRegistrationOpen = (db, open) =>
  db
    .prepare(
      "INSERT INTO settings(key,value) VALUES('registration_open',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(String(!!open));
