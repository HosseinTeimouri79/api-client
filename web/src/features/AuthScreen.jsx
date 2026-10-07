import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import { api, errorText } from "../api.js";
import { Button } from "../components/ui/Button.jsx";
import { Field } from "../components/ui/Switch.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { LOCALES, applyLocale, useI18n, useT } from "../i18n/index.js";

export function AuthScreen() {
  const authenticate = useStore((s) => s.authenticate);
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ username: "", name: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true); // self-registration allowed? (admins can turn it off)
  useEffect(() => { api("GET", "/auth/config").then((c) => { setOpen(c.registration); if (!c.registration) setMode("login"); }, () => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await authenticate(mode, mode === "login" ? { username: f.username, password: f.password } : { username: f.username, password: f.password, ...(f.name.trim() && { name: f.name.trim() }) }); }
    catch (x) { setErr(errorText(x)); }
    finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><img className="logo" src="/logo.png" alt="" /><h1>API Client</h1></div>
        <p className="muted">{t("auth.subtitle")}</p>
        {open ? <Tabs variant="pill" value={mode} onChange={(m) => { setMode(m); setErr(""); }} items={[{ id: "login", label: t("auth.signIn") }, { id: "register", label: t("auth.createAccount") }]} /> : <p className="muted auth-closed">{t("auth.closed")}</p>}
        <Field label={t("auth.username")}><input name="username" autoFocus required minLength={mode === "register" ? 3 : 1} maxLength={32} pattern={mode === "register" ? "[A-Za-z0-9._\\-]+" : undefined} title={t("auth.usernameHint")} autoComplete="username" value={f.username} onChange={set("username")} /></Field>
        {mode === "register" && <Field label={t("auth.displayNameOpt")}><input name="name" maxLength={100} autoComplete="name" value={f.name} onChange={set("name")} /></Field>}
        <Field label={t("auth.password")} hint={mode === "register" ? t("auth.min8") : undefined}><input name="password" type="password" required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} /></Field>
        {err && <div className="err" role="alert">{err}</div>}
        <Button type="submit" variant="primary" size="lg" loading={busy}>{mode === "login" ? t("auth.signIn") : t("auth.createAccount")}</Button>
        <div className="auth-lang" role="group" aria-label={t("common.language")}>{LOCALES.map((l) => <button key={l.id} type="button" className={l.id === locale ? "on" : undefined} aria-pressed={l.id === locale} onClick={() => applyLocale(l.id)}>{l.label}</button>)}</div>
      </form>
    </div>
  );
}
