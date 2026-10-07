import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useStore, can } from "../store.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button, IconButton } from "../components/ui/Button.jsx";
import { Select } from "../components/ui/Select.jsx";
import { AutoComplete, personOption, renderPerson, renderPersonChip } from "../components/ui/AutoComplete.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { toast } from "../components/ui/Toasts.jsx";
import { confirm } from "../components/ui/dialogs.jsx";

const ROLE_INFO = { admin: "Manage members, edit everything", editor: "Create and edit requests", viewer: "Run requests, read only" };
export function MembersModal({ close }) {
  const { ws, user } = useStore();
  const { W, guard, openWorkspace, loadWorkspaces } = useStore.getState();
  const c = can(ws);
  const [members, setMembers] = useState(null);
  const [audit, setAudit] = useState([]);
  const [picked, setPicked] = useState([]);
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const roles = ["admin", "editor", "viewer"].filter((r) => r !== "admin" || ws.role === "owner");

  const load = useCallback(guard(async () => {
    setMembers(await api("GET", W("/members")));
    if (c.admin) setAudit(await api("GET", W("/audit")));
  }), []);
  useEffect(() => { load(); }, []);
  // everyone who is not yet in this workspace, filtered on the server as you type
  const loadOptions = useCallback(async (q) => (await api("GET", W(`/members/candidates?q=${encodeURIComponent(q)}&limit=50`))).map(personOption), []);

  const add = guard(async () => {
    setBusy(true);
    try {
      await api("POST", W("/members"), { user_ids: picked.map((p) => p.value), role });
      toast(`${picked.length} member${picked.length > 1 ? "s" : ""} added`, "ok");
      setPicked([]);
      await load();
    } finally { setBusy(false); }
  });
  const changeRole = (m, r) => guard(async () => { try { await api("PATCH", W(`/members/${m.id}`), { role: r }); toast("Role updated", "ok"); } catch (e) { await load(); throw e; } })();
  const remove = (m) => guard(async () => {
    const self = m.id === user.id;
    if (!(await confirm({ title: self ? "Leave workspace" : "Remove member", message: self ? "Leave this workspace?" : `Remove ${m.name}?`, okText: self ? "Leave" : "Remove" }))) return;
    await api("DELETE", W(`/members/${m.id}`));
    if (self) { close(); await loadWorkspaces(); } else await load();
  })();

  return (
    <Modal title="Workspace members" size="lg" onClose={() => close()}>
      {c.admin && (
        <section className="add-members">
          <h3>Add people</h3>
          <div className="add-row">
            <AutoComplete multiple autoFocus loadOptions={loadOptions} value={picked} onChange={setPicked} placeholder="Search people by name or username…" emptyText="Nobody else to add" renderOption={renderPerson} renderChip={renderPersonChip} aria-label="People to add" />
            <Select value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: r, description: ROLE_INFO[r] }))} aria-label="Role"
              renderOption={(o) => <span className="opt-main"><span className="opt-label">{o.label}</span><span className="opt-desc">{o.description}</span></span>} />
            <Button variant="primary" icon="user-plus" disabled={!picked.length} loading={busy} onClick={add}>Add{picked.length > 1 ? ` ${picked.length}` : ""}</Button>
          </div>
        </section>
      )}
      <section>
        <h3>Members {members && <span className="count">{members.length}</span>}</h3>
        <div className="members">
          {members?.map((m) => (
            <div className="member" key={m.id}>
              <Avatar name={m.name} src={m.avatar} size={34} />
              <div className="grow"><b>{m.name}</b><div className="muted">@{m.username}</div></div>
              {m.role === "owner" || !c.admin || m.id === user.id ? <span className="role-badge">{m.role}</span> : (
                <Select value={m.role} onChange={(r) => { setMembers(members.map((x) => (x.id === m.id ? { ...x, role: r } : x))); changeRole(m, r); }} options={roles.map((r) => ({ value: r, label: r }))} aria-label={`Role of ${m.name}`} size="sm" />
              )}
              {m.role !== "owner" && (c.admin || m.id === user.id) && <IconButton icon={m.id === user.id ? "right-from-bracket" : "user-minus"} label={m.id === user.id ? "Leave" : "Remove"} onClick={() => remove(m)} />}
            </div>
          ))}
          {!members && <div className="muted pad">Loading…</div>}
        </div>
      </section>
      {c.admin && (
        <details className="audit"><summary><Icon name="clock-rotate-left" /> Audit log</summary>
          <div className="audit-list">{audit.map((a) => <div key={a.id}>{a.created_at} · {a.user ?? "?"} · {a.action} {a.target ?? ""}</div>)}</div>
        </details>
      )}
    </Modal>
  );
}
