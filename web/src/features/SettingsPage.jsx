import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.js";
import { useStore } from "../store.js";
import { useT } from "../i18n/index.js";
import { LanguageSelect } from "../components/ui/LanguageSelect.jsx";
import { squareAvatar } from "../lib/image.js";
import { Button } from "../components/ui/Button.jsx";
import { Checkbox, Field } from "../components/ui/Switch.jsx";
import { Select } from "../components/ui/Select.jsx";
import { APP_FONTS, EDITOR_FONTS, CUSTOM } from "../lib/settings.js";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { toast } from "../components/ui/Toasts.jsx";
import { PROTOCOLS } from "../lib/protocols.js";
import { Icon } from "../components/ui/Icon.jsx";

const AUTHOR = { name: "Hossein Teimouri", url: "https://github.com/HosseinTeimouri79" };
const SOURCE = "https://github.com/HosseinTeimouri79/api-client";
const LICENSE = { name: "Apache License 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" };
const CHANGELOG = "CHANGELOG.md";
const STACK = "Node.js, Express, SQLite, React, QuickJS";
const FEATURES = ["teams", "env", "scripts", "interop", "snippets", "languages", "safe", "self"];
const ext = { target: "_blank", rel: "noopener noreferrer" };

/** Settings → General → About: what the app is, its protocols and features, who made it and under which license. */
function About() {
  const t = useT();
  return (
    <div className="about-page stack">
      <div className="about-hero">
        <img className="about-logo" src="/logo.png" alt="" />
        <div>
          <h3 className="about about-name">API Client <span className="muted">v{__APP_VERSION__}</span></h3>
          <p className="muted about">{t("settings.aboutTagline")}</p>
        </div>
      </div>
      <p className="about">{t("about.whatText")}</p>
      <p className="muted about">{t("settings.aboutText")}</p>

      <h4>{t("about.protocolsTitle")}</h4>
      <div className="about-chips">{PROTOCOLS.map((p) => <span key={p.id} className="about-chip"><Icon name={p.icon} />{p.label}</span>)}</div>

      <h4>{t("about.featuresTitle")}</h4>
      <ul className="about-list">{FEATURES.map((f) => <li key={f}><Icon name="check" />{t(`about.f.${f}`)}</li>)}</ul>

      <h4>{t("about.detailsTitle")}</h4>
      <dl className="about-dl">
        <dt>{t("about.version")}</dt><dd>{__APP_VERSION__}</dd>
        <dt>{t("about.license")}</dt><dd><a href={LICENSE.url} {...ext}>{LICENSE.name}</a></dd>
        <dt>{t("about.author")}</dt><dd><a href={AUTHOR.url} {...ext}>{AUTHOR.name}</a></dd>
        <dt>{t("about.source")}</dt><dd><a href={SOURCE} {...ext}>{SOURCE.replace("https://", "")}</a></dd>
        <dt>{t("about.changelog")}</dt><dd><a href={`${SOURCE}/blob/main/CHANGELOG.md`} {...ext}>{CHANGELOG}</a></dd>
        <dt>{t("about.stack")}</dt><dd>{STACK}</dd>
      </dl>
      <p className="muted about about-note">{t("about.attribution")}</p>
    </div>
  );
}

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

function Password() {
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
    <form className="settings-sec stack" onSubmit={submit} aria-label={t("settings.password")}>
      <Field label={t("settings.currentPassword")}><input dir="ltr" type="password" required autoComplete="current-password" value={f.cur} onChange={set("cur")} /></Field>
      <Field label={t("settings.newPassword")} hint={`${t("auth.min8")}. ${t("settings.passwordHint")}`}><input dir="ltr" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={f.next} onChange={set("next")} /></Field>
      <Field label={t("settings.confirmPassword")}><input dir="ltr" type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={f.again} onChange={set("again")} /></Field>
      {err && <div className="err" role="alert">{err}</div>}
      <div><Button type="submit" variant="primary" loading={busy} disabled={!(f.cur && f.next && f.again)}>{t("settings.updatePassword")}</Button></div>
    </form>
  );
}

// ---- General (app) settings ----
const useSettings = () => {
  const settings = useStore((s) => s.settings);
  return [settings, useStore.getState().updateSettings];
};
/** A number that can be typed freely and is only committed once it is a valid value in range. */
function NumberField({ label, hint, value, min, max, step = 1, unit, onCommit }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const valid = (x) => x !== "" && Number.isFinite(Number(x)) && Number(x) >= min && Number(x) <= max;
  return (
    <Field label={unit ? `${label} (${unit})` : label} hint={hint}>
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={text} aria-invalid={!valid(text)}
        onChange={(e) => { setText(e.target.value); if (valid(e.target.value)) onCommit(Number(e.target.value)); }}
        onBlur={() => setText(String(value))} />
    </Field>
  );
}
function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle-row"><Checkbox checked={checked} onChange={onChange} label={label} /><span><span>{label}</span>{hint && <span className="muted toggle-hint">{hint}</span>}</span></label>
  );
}
/** Preset fonts plus a free "custom" family; installed fonts only. */
function FontField({ label, value, presets, defaultLabel, onChange }) {
  const t = useT();
  const isPreset = presets.some((p) => p.value === value);
  const [custom, setCustom] = useState(!isPreset);
  const options = [...presets.map((p) => ({ value: p.value, label: p.value === "" ? defaultLabel : p.label })), { value: CUSTOM, label: t("settings.fontCustom") }];
  return (
    <Field label={label}>
      <Select aria-label={label} value={custom ? CUSTOM : value} options={options}
        onChange={(v) => { if (v === CUSTOM) setCustom(true); else { setCustom(false); onChange(v); } }} />
      {custom && <input dir="ltr" value={value} maxLength={200} placeholder={t("settings.fontPlaceholder")} aria-label={`${label} (${t("settings.fontCustom")})`}
        onChange={(e) => !/[^\w\s,'"\-.()]/.test(e.target.value) && onChange(e.target.value)} />}
    </Field>
  );
}

function General({ sub }) {
  const t = useT();
  const [s, update] = useSettings();
  const e = s.editor;
  // one panel per tab; only the selected one is rendered
  const panels = {
    request: (<>
        <NumberField label={t("settings.timeout")} unit="ms" min={0} max={3600000} step={1000} value={s.request.timeoutMs} hint={t("settings.timeoutHint")} onCommit={(v) => update({ request: { timeoutMs: v } })} />
        <NumberField label={t("settings.maxResponse")} unit="MB" min={0} max={4096} value={s.request.maxResponseMb} hint={t("settings.maxResponseHint")} onCommit={(v) => update({ request: { maxResponseMb: v } })} />
      </>),
    ui: (<>
        <Toggle label={t("settings.openConsole")} hint={t("settings.openConsoleHint")} checked={s.ui.openConsole} onChange={(v) => update({ ui: { openConsole: v } })} />
        <Field label={t("settings.layout")}>
          <Select aria-label={t("settings.layout")} value={s.ui.layout} onChange={(v) => update({ ui: { layout: v } })}
            options={[{ value: "stacked", label: t("settings.layoutStacked"), icon: "table-cells-large" }, { value: "side", label: t("settings.layoutSide"), icon: "table-columns" }]} />
        </Field>
      </>),
    editor: (<>
        <FontField label={t("settings.fontFamily")} value={e.fontFamily} presets={EDITOR_FONTS} defaultLabel={t("settings.fontMono")} onChange={(v) => update({ editor: { fontFamily: v } })} />
        <div className="grid2">
          <NumberField label={t("settings.fontSize")} unit="px" min={8} max={32} value={e.fontSize} onCommit={(v) => update({ editor: { fontSize: Math.round(v) } })} />
          <NumberField label={t("settings.indentCount")} min={1} max={8} value={e.indentCount} hint={t("settings.indentCountHint")} onCommit={(v) => update({ editor: { indentCount: Math.round(v) } })} />
        </div>
        <Field label={t("settings.indentType")} hint={t("settings.indentTypeHint")}>
          <Tabs variant="pill" value={e.indentType} onChange={(v) => update({ editor: { indentType: v } })} items={[{ id: "space", label: t("settings.spaces") }, { id: "tab", label: t("settings.tabs") }]} />
        </Field>
        <Toggle label={t("settings.autoBrackets")} checked={e.autoCloseBrackets} onChange={(v) => update({ editor: { autoCloseBrackets: v } })} />
        <Toggle label={t("settings.autoQuotes")} checked={e.autoCloseQuotes} onChange={(v) => update({ editor: { autoCloseQuotes: v } })} />
        <pre className="editor-preview" dir="ltr" aria-label={t("settings.preview")}>{`{\n${e.indentType === "tab" ? "\t" : " ".repeat(e.indentCount)}"hello": "world",\n${e.indentType === "tab" ? "\t" : " ".repeat(e.indentCount)}"items": [1, 2, 3]\n}`}</pre>
      </>),
    application: (<>
        <Field label={t("settings.theme")}>
          <Tabs variant="pill" value={s.app.theme} onChange={(v) => update({ app: { theme: v } })} items={[{ id: "dark", label: t("settings.dark") }, { id: "light", label: t("settings.light") }]} />
        </Field>
        <Field label={t("common.language")}>
          <LanguageSelect />
        </Field>
        <FontField label={t("settings.appFont")} value={s.app.fontFamily} presets={APP_FONTS} defaultLabel={t("settings.fontDefault")} onChange={(v) => update({ app: { fontFamily: v } })} />
        <Toggle label={t("settings.autosave")} hint={t("settings.autosaveHint")} checked={s.app.autosave} onChange={(v) => update({ app: { autosave: v } })} />
      </>),
    about: <About />,
  };
  return <section className="settings-sec stack" role="tabpanel">{panels[sub]}</section>;
}

const PROFILE_TABS = [{ id: "details", key: "settings.details" }, { id: "password", key: "settings.password" }];
const GENERAL_TABS = [{ id: "application", key: "settings.application" }, { id: "ui", key: "settings.ui" }, { id: "request", key: "settings.request" }, { id: "editor", key: "settings.editor" }, { id: "about", key: "settings.about" }];

export function SettingsPage() {
  const t = useT();
  const [tab, setTab] = useState("profile");
  const [sub, setSub] = useState({ profile: "details", general: "application" });
  const subs = tab === "profile" ? PROFILE_TABS : GENERAL_TABS;
  return (
    <div className="admin body">
      <div className="admin-in settings-in">
        <div className="row admin-head"><Button icon="arrow-left" onClick={() => useStore.setState({ view: "app" })}>{t("settings.back")}</Button><h2 className="grow">{t("settings.title")}</h2></div>
        <Tabs value={tab} onChange={setTab} items={[{ id: "profile", label: t("settings.tab.profile") }, { id: "general", label: t("settings.tab.general") }]} />
        <div className="admin-card">
          <Tabs variant="pill" className="settings-subtabs" value={sub[tab]} onChange={(v) => setSub({ ...sub, [tab]: v })} items={subs.map((x) => ({ id: x.id, label: t(x.key) }))} />
          {tab === "profile" ? (sub.profile === "details" ? <Profile /> : <Password />) : <General sub={sub.general} />}
        </div>
      </div>
    </div>
  );
}
