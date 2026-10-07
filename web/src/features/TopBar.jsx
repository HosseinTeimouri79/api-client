import { useMemo, useRef } from "react";
import { useStore, can } from "../store.js";
import { modals } from "../components/ui/modals.js";
import { Select } from "../components/ui/Select.jsx";
import { Button, IconButton } from "../components/ui/Button.jsx";
import { Menu, useMenu } from "../components/ui/Menu.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { EnvModal } from "./EnvModal.jsx";
import { MembersModal } from "./MembersModal.jsx";
import { InteropModal } from "./InteropModal.jsx";

export function TopBar() {
  const { user, ws, workspaces, envs, envId, theme, sidebarOpen } = useStore();
  const { set, setTheme, openWorkspace, createWorkspace, logout, guard } = useStore.getState();
  const more = useMenu(), userMenu = useMenu();
  const moreBtn = useRef(null), userBtn = useRef(null);
  const wsOptions = useMemo(() => [...workspaces.map((w) => ({ value: w.id, label: w.name, description: w.role, icon: "briefcase" })), { value: "+", label: "New workspace…", icon: "plus" }], [workspaces]);
  const envOptions = useMemo(() => [{ value: "", label: "No environment", icon: "ban" }, ...envs.map((e) => ({ value: e.id, label: e.name, icon: "layer-group" }))], [envs]);
  const c = can(ws);
  return (
    <header className="top">
      <IconButton className="menu-btn" icon="bars" label="Menu" onClick={() => set({ sidebarOpen: !sidebarOpen })} />
      <div className="brand"><img className="logo" src="/logo.png" alt="" /><span className="brand-t">API Client</span></div>
      <Select className="ws-select" aria-label="Workspace" value={ws?.id} options={wsOptions} placeholder="No workspace" onChange={(v) => (v === "+" ? createWorkspace() : openWorkspace(v))}
        renderOption={(o) => <><Icon name={o.icon} className="opt-icon" /><span className="opt-main"><span className="opt-label">{o.label}</span>{o.description && <span className="opt-desc">{o.description}</span>}</span></>} />
      {ws && <span className="role-badge">{ws.role}</span>}
      <span className="grow" />
      {ws && (
        <>
          <Select className="env-select" aria-label="Environment" title="Environment" value={envId ?? ""} options={envOptions} onChange={(v) => set({ envId: v || null })} renderValue={(o) => <><Icon name="layer-group" />{o.label}</>} />
          <Button icon="sliders" title="Manage environments & variables" onClick={() => modals.open((close) => <EnvModal close={close} />)}><span className="hide-sm">Environments</span></Button>
          <IconButton ref={moreBtn} icon="ellipsis" label="More" onClick={() => more.show(moreBtn.current)} />
          <Menu {...more} onClose={more.hide} placement="bottom-end" items={[
            { label: "Members", icon: "users", onClick: () => modals.open((close) => <MembersModal close={close} />) },
            { label: "Import / Export", icon: "right-left", onClick: () => modals.open((close) => <InteropModal close={close} />) },
          ]} />
        </>
      )}
      <IconButton icon={theme === "dark" ? "sun" : "moon"} label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} />
      <button ref={userBtn} className="user-btn" aria-label="Account" onClick={() => userMenu.show(userBtn.current)}><Avatar name={user.name} size={30} /></button>
      <Menu {...userMenu} onClose={userMenu.hide} placement="bottom-end" items={[
        { label: `${user.name} (@${user.username})`, icon: "circle-user", disabled: true },
        "-",
        { label: "Sign out", icon: "right-from-bracket", onClick: logout },
      ]} />
    </header>
  );
}
