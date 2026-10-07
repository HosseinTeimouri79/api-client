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

const PAGE = 50;
const day = (s) => String(s ?? "").slice(0, 10);
const randomPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), (n) => chars[n % chars.length]).join("");
};
/** Runs `fn`; failures show as a toast and the panel bounces to login on 401. */
const run = (fn) => useStore.getState().guard(fn)();

function UserForm({ close, user }) {
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
      toast(editing ? "User updated" : "User created", "ok");
      close(true);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  const self = editing && user.id === useStore.getState().user.id;
  return (
    <Modal title={editing ? `Edit @${user.username}` : "New user"} size="sm" onClose={() => close(false)}
      footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant="primary" type="submit" form="user-form" loading={busy}>{editing ? "Save" : "Create user"}</Button></>}>
      <form id="user-form" className="stack" onSubmit={submit}>
        <Field label="Username"><input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._\-]+" title="Letters, digits, dot, underscore, dash" dir="ltr" value={f.username} onChange={set("username")} autoComplete="off" /></Field>
        <Field label="Display name"><input maxLength={100} value={f.name} onChange={set("name")} placeholder={editing ? undefined : "Same as username"} autoComplete="off" /></Field>
        {!editing && <Field label="Initial password" hint="Share it with the user; at least 8 characters"><input dir="ltr" required minLength={8} maxLength={200} value={f.password} onChange={set("password")} className="mono" autoComplete="off" /></Field>}
        <label className="row"><Checkbox checked={f.is_admin} disabled={self} label="Administrator" onChange={(v) => setF({ ...f, is_admin: v })} /> <span>Administrator <span className="muted">— can open this panel</span></span></label>
        {err && <div className="err" role="alert">{err}</div>}
      </form>
    </Modal>
  );
}

function PasswordForm({ close, user }) {
  const [password, setPassword] = useState(randomPassword);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("POST", `/admin/users/${user.id}/password`, { password });
      toast(`Password changed for @${user.username}`, "ok");
      close(true);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Reset password for @${user.username}`} size="sm" onClose={() => close(false)}
      footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant="primary" type="submit" form="pw-form" loading={busy}>Set password</Button></>}>
      <form id="pw-form" className="stack" onSubmit={submit}>
        <Field label="New password" hint="They are signed out everywhere and must use this password next. At least 8 characters.">
          <div className="row"><input dir="ltr" className="grow mono" required minLength={8} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" data-autofocus />
            <IconButton icon="dice" label="Generate" onClick={() => setPassword(randomPassword())} />
            <IconButton icon="copy" label="Copy" onClick={() => navigator.clipboard?.writeText(password).then(() => toast("Copied", "ok"), () => toast("Copy failed", "error"))} /></div>
        </Field>
        {err && <div className="err" role="alert">{err}</div>}
      </form>
    </Modal>
  );
}

function Users({ me, reload }) {
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
    if (!u.disabled && !(await confirm({ title: "Disable account", message: `@${u.username} will be signed out and unable to sign in until re-enabled.`, okText: "Disable" }))) return;
    patch(u, { disabled: !u.disabled }, u.disabled ? "Account enabled" : "Account disabled");
  };
  const remove = async (u) => {
    if (!(await confirm({ title: "Delete user", message: `Permanently delete @${u.username} and their history? This can't be undone.` }))) return;
    run(async () => { await api("DELETE", `/admin/users/${u.id}`); toast("User deleted", "ok"); if (data.users.length === 1 && offset) setOffset(offset - PAGE); else refresh(); });
  };
  const edit = async (u) => { if (await modals.open((close) => <UserForm close={close} user={u} />)) refresh(); };
  const create = async () => { if (await modals.open((close) => <UserForm close={close} />)) { setOffset(0); refresh(); } };
  const reset = (u) => modals.open((close) => <PasswordForm close={close} user={u} />);

  return (
    <>
      <div className="row wrap admin-bar">
        <div className="grow admin-search"><Icon name="magnifying-glass" /><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search by name or username…" aria-label="Search by name or username…" /></div>
        <Button variant="primary" icon="user-plus" onClick={create}>New user</Button>
      </div>
      {!data ? <div className="muted pad"><Spinner /></div> : !data.users.length ? <div className="empty-mini"><Icon name="users-slash" className="big" />No users match.</div> : (
        <div className="atable-wrap">
          <table className="atable">
            <thead><tr><th>User</th><th>Status</th><th className="num">Workspaces</th><th>Joined</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} className={u.disabled ? "off" : undefined}>
                    <td><div className="row"><Avatar name={u.name} size={30} /><div><b>{u.name}</b>{self && <span className="muted"> (you)</span>}<div className="muted" dir="ltr">@{u.username}</div></div></div></td>
                    <td><span className="row wrap">{u.is_admin && <span className="role-badge admin-badge">admin</span>}{u.disabled && <span className="role-badge off-badge">disabled</span>}{!u.is_admin && !u.disabled && <span className="muted">active</span>}</span></td>
                    <td className="num">{u.workspaces}</td>
                    <td className="muted">{day(u.created_at)}</td>
                    <td><div className="row end actions">
                      <IconButton icon="pen" label="Edit user" size="sm" onClick={() => edit(u)} />
                      <IconButton icon="key" label="Reset password" size="sm" onClick={() => reset(u)} />
                      <IconButton icon={u.disabled ? "user-check" : "user-slash"} label={u.disabled ? "Enable account" : "Disable account"} size="sm" disabled={self} onClick={() => toggleDisabled(u)} />
                      <IconButton icon="trash" label="Delete user" size="sm" disabled={self} onClick={() => remove(u)} />
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
          <span className="row"><Button size="sm" icon="chevron-left" disabled={!offset} onClick={() => setOffset(offset - PAGE)}>Prev</Button><Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next <Icon name="chevron-right" /></Button></span>
        </div>
      )}
    </>
  );
}

function Workspaces({ reload }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const load = useCallback(() => run(async () => setRows(await api("GET", `/admin/workspaces?q=${encodeURIComponent(q)}`))), [q]);
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [load]);
  const remove = async (w) => {
    if (!(await confirm({ title: "Delete workspace", message: `Delete “${w.name}” with all its collections, requests and environments? This can't be undone.` }))) return;
    run(async () => { await api("DELETE", `/admin/workspaces/${w.id}`); toast("Workspace deleted", "ok"); load(); reload(); });
  };
  return (
    <>
      <div className="row wrap admin-bar"><div className="grow admin-search"><Icon name="magnifying-glass" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by workspace or owner…" aria-label="Search by workspace or owner…" /></div></div>
      {!rows ? <div className="muted pad"><Spinner /></div> : !rows.length ? <div className="empty-mini"><Icon name="briefcase" className="big" />No workspaces.</div> : (
        <div className="atable-wrap">
          <table className="atable">
            <thead><tr><th>Workspace</th><th>Owner</th><th className="num">Members</th><th className="num">Requests</th><th>Created</th><th aria-label="Actions" /></tr></thead>
            <tbody>{rows.map((w) => (
              <tr key={w.id}><td><b>{w.name}</b></td><td className="muted" dir="ltr">@{w.owner}</td><td className="num">{w.members}</td><td className="num">{w.requests}</td><td className="muted">{day(w.created_at)}</td>
                <td><div className="row end actions"><IconButton icon="trash" label="Delete workspace" size="sm" onClick={() => remove(w)} /></div></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

const ACTION_LABEL = {
  "admin.user.create": "created user", "admin.user.update": "updated user", "admin.user.password_reset": "reset password of",
  "admin.user.delete": "deleted user", "admin.workspace.delete": "deleted workspace",
};
function Activity() {
  const [rows, setRows] = useState(null);
  useEffect(() => { run(async () => setRows(await api("GET", "/admin/audit"))); }, []);
  if (!rows) return <div className="muted pad"><Spinner /></div>;
  if (!rows.length) return <div className="empty-mini"><Icon name="clock-rotate-left" className="big" />No admin activity yet.</div>;
  return (
    <div className="admin-activity">{rows.map((a) => (
      <div key={a.id} className="member"><span className="muted mono" dir="ltr">{a.created_at}</span><span className="grow"><b>@{a.user ?? "?"}</b> {ACTION_LABEL[a.action] ?? a.action} <code dir="ltr">{a.target}</code></span></div>
    ))}</div>
  );
}

export function AdminPanel() {
  const me = useStore((s) => s.user);
  const setView = (view) => useStore.setState({ view });
  const [tab, setTab] = useState("users");
  const [stats, setStats] = useState(null);
  const reload = useCallback(() => run(async () => setStats(await api("GET", "/admin/stats"))), []);
  useEffect(() => { reload(); }, []);
  const tiles = stats && [["Users", stats.users, "users"], ["Admins", stats.admins, "user-shield"], ["Disabled", stats.disabled, "user-slash"], ["Workspaces", stats.workspaces, "briefcase"], ["Requests", stats.requests, "paper-plane"]];
  return (
    <div className="admin body">
      <div className="admin-in">
        <div className="row admin-head"><Button icon="arrow-left" onClick={() => setView("app")}>Back to app</Button><h2 className="grow">Admin panel</h2></div>
        <div className="admin-tiles">{tiles?.map(([label, n, icon]) => <div className="admin-tile" key={label}><Icon name={icon} /><div><b>{n}</b><span className="muted">{label}</span></div></div>)}</div>
        <Tabs value={tab} onChange={setTab} items={[{ id: "users", label: "Users", badge: stats?.users }, { id: "workspaces", label: "Workspaces", badge: stats?.workspaces }, { id: "activity", label: "Activity" }]} />
        <div className="admin-card">
          {tab === "users" ? <Users me={me} reload={reload} /> : tab === "workspaces" ? <Workspaces reload={reload} /> : <Activity />}
        </div>
      </div>
    </div>
  );
}
