import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.js";
import { useStore } from "../store.js";
import { modals } from "../components/ui/modals.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button, IconButton } from "../components/ui/Button.jsx";
import { Checkbox, Field } from "../components/ui/Switch.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { Icon, Spinner } from "../components/ui/Icon.jsx";
import { toast } from "../components/ui/Toasts.jsx";
import { confirm } from "../components/ui/dialogs.jsx";
import { useT } from "../i18n/index.js";

const PAGE = 50;
const day = (s) => String(s ?? "").slice(0, 10);
const randomPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), (n) => chars[n % chars.length]).join("");
};
/** Runs `fn`; failures show as a toast and the panel bounces to login on 401. */
const run = (fn) => useStore.getState().guard(fn)();

function UserForm({ close, user }) {
  const t = useT();
  const editing = !!user;
  const [f, setF] = useState({ username: user?.username ?? "", name: user?.name ?? "", password: editing ? "" : randomPassword(), is_admin: user?.is_admin ?? false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      if (editing) await api("PATCH", `/admin/users/${user.id}`, { username: f.username, name: f.name, is_admin: f.is_admin });
      else await api("POST", "/admin/users", { username: f.username, name: f.name || undefined, password: f.password, is_admin: f.is_admin });
      toast(editing ? t("admin.userUpdated") : t("admin.userCreated"), "ok");
      close(true);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const self = editing && user.id === useStore.getState().user.id;
  return (
    <Modal title={editing ? t("admin.editTitle", { u: user.username }) : t("admin.newUserTitle")} size="sm" onClose={() => close(false)}
      footer={<><Button onClick={() => close(false)}>{t("common.cancel")}</Button><Button variant="primary" type="submit" form="user-form" loading={busy}>{editing ? t("common.save") : t("admin.createUser")}</Button></>}>
      <form id="user-form" className="stack" onSubmit={submit}>
        <Field label={t("auth.username")}><input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._\-]+" title={t("auth.usernameHint")} dir="ltr" value={f.username} onChange={set("username")} autoComplete="off" /></Field>
        <Field label={t("admin.displayName")}><input maxLength={100} value={f.name} onChange={set("name")} placeholder={editing ? undefined : t("admin.sameAsUsername")} autoComplete="off" /></Field>
        {!editing && <Field label={t("admin.initialPassword")} hint={t("admin.initialPasswordHint")}><input dir="ltr" required minLength={8} maxLength={200} value={f.password} onChange={set("password")} className="mono" autoComplete="off" /></Field>}
        <label className="row"><Checkbox checked={f.is_admin} disabled={self} label={t("admin.administrator")} onChange={(v) => setF({ ...f, is_admin: v })} /> <span>{t("admin.administrator")} <span className="muted">— {t("admin.administratorHint")}</span></span></label>
        {err && <div className="err" role="alert">{err}</div>}
      </form>
    </Modal>
  );
}

function PasswordForm({ close, user }) {
  const t = useT();
  const [password, setPassword] = useState(randomPassword);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("POST", `/admin/users/${user.id}/password`, { password });
      toast(t("admin.passwordChanged", { u: user.username }), "ok");
      close(true);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title={t("admin.resetTitle", { u: user.username })} size="sm" onClose={() => close(false)}
      footer={<><Button onClick={() => close(false)}>{t("common.cancel")}</Button><Button variant="primary" type="submit" form="pw-form" loading={busy}>{t("admin.setPassword")}</Button></>}>
      <form id="pw-form" className="stack" onSubmit={submit}>
        <Field label={t("admin.newPassword")} hint={t("admin.resetHint")}>
          <div className="row"><input dir="ltr" className="grow mono" required minLength={8} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" data-autofocus />
            <IconButton icon="dice" label={t("admin.generate")} onClick={() => setPassword(randomPassword())} />
            <IconButton icon="copy" label={t("common.copy")} onClick={() => navigator.clipboard?.writeText(password).then(() => toast(t("common.copied"), "ok"), () => toast(t("common.copyFailed"), "error"))} /></div>
        </Field>
        {err && <div className="err" role="alert">{err}</div>}
      </form>
    </Modal>
  );
}

function Users({ me, reload }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const d = await api("GET", `/admin/users?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`);
      if (n === seq.current) setData(d);
    } catch (e) { if (n === seq.current) { toast(errorText(e), "error"); if (e.status === 401) useStore.setState({ user: null }); } }
  }, [q, offset]);
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [load]);
  const refresh = () => { load(); reload(); };

  const patch = (u, body, msg) => run(async () => { await api("PATCH", `/admin/users/${u.id}`, body); toast(msg, "ok"); refresh(); });
  const toggleDisabled = async (u) => {
    if (!u.disabled && !(await confirm({ title: t("admin.disableTitle"), message: t("admin.disableMsg", { u: u.username }), okText: t("admin.disableBtn") }))) return;
    patch(u, { disabled: !u.disabled }, u.disabled ? t("admin.enabled") : t("admin.disabledToast"));
  };
  const remove = async (u) => {
    if (!(await confirm({ title: t("admin.deleteUserTitle"), message: t("admin.deleteUserMsg", { u: u.username }) }))) return;
    run(async () => { await api("DELETE", `/admin/users/${u.id}`); toast(t("admin.userDeleted"), "ok"); if (data.users.length === 1 && offset) setOffset(offset - PAGE); else refresh(); });
  };
  const edit = async (u) => { if (await modals.open((close) => <UserForm close={close} user={u} />)) refresh(); };
  const create = async () => { if (await modals.open((close) => <UserForm close={close} />)) { setOffset(0); refresh(); } };
  const reset = (u) => modals.open((close) => <PasswordForm close={close} user={u} />);

  return (
    <>
      <div className="row wrap admin-bar">
        <div className="grow admin-search"><Icon name="magnifying-glass" /><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder={t("admin.searchUsers")} aria-label={t("admin.searchUsers")} /></div>
        <Button variant="primary" icon="user-plus" onClick={create}>{t("admin.newUser")}</Button>
      </div>
      {!data ? <div className="muted pad"><Spinner /></div> : !data.users.length ? <div className="empty-mini"><Icon name="users-slash" className="big" />{t("admin.noUsers")}</div> : (
        <div className="atable-wrap">
          <table className="atable">
            <thead><tr><th>{t("admin.col.user")}</th><th>{t("admin.col.status")}</th><th className="num">{t("admin.col.workspaces")}</th><th>{t("admin.col.joined")}</th><th aria-label={t("admin.col.actions")} /></tr></thead>
            <tbody>
              {data.users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} className={u.disabled ? "off" : undefined}>
                    <td><div className="row"><Avatar name={u.name} src={u.avatar} size={30} /><div><b>{u.name}</b>{self && <span className="muted"> {t("common.you")}</span>}<div className="muted" dir="ltr">@{u.username}</div></div></div></td>
                    <td><span className="row wrap">{u.is_admin && <span className="role-badge admin-badge">{t("admin.badge.admin")}</span>}{u.disabled && <span className="role-badge off-badge">{t("admin.badge.disabled")}</span>}{!u.is_admin && !u.disabled && <span className="muted">{t("admin.active")}</span>}</span></td>
                    <td className="num">{u.workspaces}</td>
                    <td className="muted">{day(u.created_at)}</td>
                    <td><div className="row end actions">
                      <IconButton icon="pen" label={t("admin.editUser")} size="sm" onClick={() => edit(u)} />
                      <IconButton icon="key" label={t("admin.resetPassword")} size="sm" onClick={() => reset(u)} />
                      <IconButton icon={u.disabled ? "user-check" : "user-slash"} label={u.disabled ? t("admin.enable") : t("admin.disable")} size="sm" disabled={self} onClick={() => toggleDisabled(u)} />
                      <IconButton icon="trash" label={t("admin.deleteUser")} size="sm" disabled={self} onClick={() => remove(u)} />
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE && (
        <div className="row between admin-pager">
          <span className="muted">{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <span className="row"><Button size="sm" icon="chevron-left" disabled={!offset} onClick={() => setOffset(offset - PAGE)}>{t("common.prev")}</Button><Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>{t("common.next")} <Icon name="chevron-right" /></Button></span>
        </div>
      )}
    </>
  );
}

function Workspaces({ reload }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const load = useCallback(() => run(async () => setRows(await api("GET", `/admin/workspaces?q=${encodeURIComponent(q)}`))), [q]);
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [load]);
  const remove = async (w) => {
    if (!(await confirm({ title: t("admin.deleteWsTitle"), message: t("admin.deleteWsMsg", { name: w.name }) }))) return;
    run(async () => { await api("DELETE", `/admin/workspaces/${w.id}`); toast(t("admin.wsDeleted"), "ok"); load(); reload(); });
  };
  return (
    <>
      <div className="row wrap admin-bar"><div className="grow admin-search"><Icon name="magnifying-glass" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.searchWorkspaces")} aria-label={t("admin.searchWorkspaces")} /></div></div>
      {!rows ? <div className="muted pad"><Spinner /></div> : !rows.length ? <div className="empty-mini"><Icon name="briefcase" className="big" />{t("admin.noWorkspaces")}</div> : (
        <div className="atable-wrap">
          <table className="atable">
            <thead><tr><th>{t("admin.col.workspace")}</th><th>{t("admin.col.owner")}</th><th className="num">{t("admin.col.members")}</th><th className="num">{t("admin.col.requests")}</th><th>{t("admin.col.created")}</th><th aria-label={t("admin.col.actions")} /></tr></thead>
            <tbody>{rows.map((w) => (
              <tr key={w.id}><td><b>{w.name}</b></td><td className="muted" dir="ltr">@{w.owner}</td><td className="num">{w.members}</td><td className="num">{w.requests}</td><td className="muted">{day(w.created_at)}</td>
                <td><div className="row end actions"><IconButton icon="trash" label={t("admin.deleteWorkspace")} size="sm" onClick={() => remove(w)} /></div></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

const ACTION_KEY = {
  "admin.user.create": "admin.act.create", "admin.user.update": "admin.act.update", "admin.user.password_reset": "admin.act.reset",
  "admin.settings.update": "admin.act.settings", "admin.user.delete": "admin.act.delete", "admin.workspace.delete": "admin.act.wsDelete",
};
function SettingsTab() {
  const t = useT();
  const [open, setOpen] = useState(null);
  useEffect(() => { run(async () => setOpen((await api("GET", "/admin/settings")).registration_open)); }, []);
  const toggle = (v) => run(async () => {
    setOpen(v); // optimistic; the server answer is the truth
    try { setOpen((await api("PATCH", "/admin/settings", { registration_open: v })).registration_open); toast(t("common.saved"), "ok"); }
    catch (e) { setOpen(!v); throw e; }
  });
  if (open === null) return <div className="muted pad"><Spinner /></div>;
  return (
    <section className="settings-sec stack">
      <h3>{t("admin.registration")}</h3>
      <label className="row"><Checkbox checked={open} label={t("admin.registration")} onChange={toggle} /> <span>{open ? t("admin.registrationOn") : t("admin.registrationOff")}</span></label>
      <span className="muted">{t("admin.registrationHint")}</span>
    </section>
  );
}

function Activity() {
  const t = useT();
  const [rows, setRows] = useState(null);
  useEffect(() => { run(async () => setRows(await api("GET", "/admin/audit"))); }, []);
  if (!rows) return <div className="muted pad"><Spinner /></div>;
  if (!rows.length) return <div className="empty-mini"><Icon name="clock-rotate-left" className="big" />{t("admin.noActivity")}</div>;
  return (
    <div className="admin-activity">{rows.map((a) => (
      <div key={a.id} className="member"><span className="muted mono" dir="ltr">{a.created_at}</span><span className="grow"><b>@{a.user ?? "?"}</b> {ACTION_KEY[a.action] ? t(ACTION_KEY[a.action]) : a.action} <code dir="ltr">{a.target}</code></span></div>
    ))}</div>
  );
}

export function AdminPanel() {
  const t = useT();
  const me = useStore((s) => s.user);
  const setView = (view) => useStore.setState({ view });
  const [tab, setTab] = useState("users");
  const [stats, setStats] = useState(null);
  const reload = useCallback(() => run(async () => setStats(await api("GET", "/admin/stats"))), []);
  useEffect(() => { reload(); }, []);
  const tiles = stats && [[t("admin.users"), stats.users, "users"], [t("admin.admins"), stats.admins, "user-shield"], [t("admin.disabled"), stats.disabled, "user-slash"], [t("admin.workspaces"), stats.workspaces, "briefcase"], [t("admin.requests"), stats.requests, "paper-plane"]];
  return (
    <div className="admin body">
      <div className="admin-in">
        <div className="row admin-head"><Button icon="arrow-left" onClick={() => setView("app")}>{t("settings.back")}</Button><h2 className="grow">{t("admin.title")}</h2></div>
        <div className="admin-tiles">{tiles?.map(([label, n, icon]) => <div className="admin-tile" key={label}><Icon name={icon} /><div><b>{n}</b><span className="muted">{label}</span></div></div>)}</div>
        <Tabs value={tab} onChange={setTab} items={[{ id: "users", label: t("admin.users"), badge: stats?.users }, { id: "workspaces", label: t("admin.workspaces"), badge: stats?.workspaces }, { id: "activity", label: t("admin.activity") }, { id: "settings", label: t("admin.settings") }]} />
        <div className="admin-card">
          {tab === "users" ? <Users me={me} reload={reload} /> : tab === "workspaces" ? <Workspaces reload={reload} /> : tab === "settings" ? <SettingsTab /> : <Activity />}
        </div>
      </div>
    </div>
  );
}
