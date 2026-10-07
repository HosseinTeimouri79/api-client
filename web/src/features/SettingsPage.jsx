import { useRef, useState } from "react";
import { api, errorText } from "../api.js";
import { useStore } from "../store.js";
import { LOCALES, useI18n, useT } from "../i18n/index.js";
import { squareAvatar } from "../lib/image.js";
import { Button } from "../components/ui/Button.jsx";
import { Field } from "../components/ui/Switch.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { toast } from "../components/ui/Toasts.jsx";

function Profile() {
  const t = useT();
  const user = useStore((s) => s.user);
  const [f, setF] = useState({ name: user.name, username: user.username });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef(null);
  const dirty = f.name.trim() !== user.name || f.username.trim().toLowerCase() !== user.username;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const { user: u } = await api("PATCH", "/me", { name: f.name, username: f.username });
      useStore.getState().setUser(u);
      setF({ name: u.name, username: u.username });
      toast(t("settings.profileSaved"), "ok");
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const pick = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setPhotoBusy(true);
    try {
      let blob;
      try { blob = await squareAvatar(picked); } catch { toast(t("settings.badImage"), "error"); return; }
      useStore.getState().setUser((await api("PUT", "/me/avatar", blob)).user);
      toast(t("settings.photoUpdated"), "ok");
    } catch (x) { toast(errorText(x), "error"); } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    setPhotoBusy(true);
    try { useStore.getState().setUser((await api("DELETE", "/me/avatar")).user); toast(t("settings.photoRemoved"), "ok"); }
    catch (x) { toast(errorText(x), "error"); } finally { setPhotoBusy(false); }
  };
  return (
    <>
      <section className="settings-sec">
        <h3>{t("settings.photo")}</h3>
        <div className="row photo-row">
          <Avatar name={user.name} src={user.avatar} size={88} />
          <div className="stack">
            <div className="row wrap">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
              <Button icon="camera" loading={photoBusy} onClick={() => file.current.click()}>{user.avatar ? t("settings.change") : t("settings.upload")}</Button>
              {user.avatar && <Button icon="trash" disabled={photoBusy} onClick={removePhoto}>{t("settings.removePhoto")}</Button>}
            </div>
            <span className="muted">{t("settings.photoHint")}</span>
          </div>
        </div>
      </section>
      <form className="settings-sec stack" onSubmit={save}>
        <h3>{t("settings.details")}</h3>
        <Field label={t("settings.displayName")}><input required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
        <Field label={t("settings.username")} hint={t("settings.usernameHint")}><input dir="ltr" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._\-]+" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="username" /></Field>
        {err && <div className="err" role="alert">{err}</div>}
        <div><Button type="submit" variant="primary" loading={busy} disabled={!dirty}>{t("common.save")}</Button></div>
      </form>
    </>
  );
}

function Preferences() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const theme = useStore((s) => s.theme);
  const { setLocale, setTheme } = useStore.getState();
  return (
    <>
      <section className="settings-sec stack">
        <h3>{t("settings.language")}</h3>
        <Tabs variant="pill" value={locale} onChange={setLocale} items={LOCALES.map((l) => ({ id: l.id, label: l.label }))} />
        <span className="muted">{t("settings.languageHint")}</span>
      </section>
      <section className="settings-sec stack">
        <h3>{t("settings.theme")}</h3>
        <Tabs variant="pill" value={theme} onChange={setTheme} items={[{ id: "dark", label: t("settings.dark") }, { id: "light", label: t("settings.light") }]} />
      </section>
    </>
  );
}

function Security() {
  const t = useT();
  const [f, setF] = useState({ cur: "", next: "", again: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.next !== f.again) return setErr(t("settings.passwordMismatch"));
    setBusy(true); setErr("");
    try {
      await api("POST", "/me/password", { current_password: f.cur, new_password: f.next });
      setF({ cur: "", next: "", again: "" });
      toast(t("settings.passwordChanged"), "ok");
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <form className="settings-sec stack" onSubmit={submit}>
      <h3>{t("settings.password")}</h3>
      <Field label={t("settings.currentPassword")}><input dir="ltr" type="password" required autoComplete="current-password" value={f.cur} onChange={set("cur")} /></Field>
      <Field label={t("settings.newPassword")} hint={`${t("auth.min8")}. ${t("settings.passwordHint")}`}><input dir="ltr" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={f.next} onChange={set("next")} /></Field>
      <Field label={t("settings.confirmPassword")}><input dir="ltr" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={f.again} onChange={set("again")} /></Field>
      {err && <div className="err" role="alert">{err}</div>}
      <div><Button type="submit" variant="primary" loading={busy}>{t("settings.updatePassword")}</Button></div>
    </form>
  );
}

export function SettingsPage() {
  const t = useT();
  const [tab, setTab] = useState("profile");
  return (
    <div className="admin body">
      <div className="admin-in settings-in">
        <div className="row admin-head"><Button icon="arrow-left" onClick={() => useStore.setState({ view: "app" })}>{t("settings.back")}</Button><h2 className="grow">{t("settings.title")}</h2></div>
        <Tabs value={tab} onChange={setTab} items={[{ id: "profile", label: t("settings.tab.profile") }, { id: "preferences", label: t("settings.tab.preferences") }, { id: "security", label: t("settings.tab.security") }]} />
        <div className="admin-card">{tab === "profile" ? <Profile /> : tab === "preferences" ? <Preferences /> : <Security />}</div>
      </div>
    </div>
  );
}
