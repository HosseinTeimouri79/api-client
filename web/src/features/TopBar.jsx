import { useMemo, useRef } from "react";
import { useStore, can } from "../store.js";
import { modals } from "../components/ui/modals.js";
import { Select } from "../components/ui/Select.jsx";
import { IconButton } from "../components/ui/Button.jsx";
import { Menu, useMenu } from "../components/ui/Menu.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { EnvFormModal, GlobalsModal } from "./EnvModal.jsx";
import { MembersModal } from "./MembersModal.jsx";
import { InteropModal } from "./InteropModal.jsx";
import { useI18n, useT } from "../i18n/index.js";
import { LanguageSelect } from "../components/ui/LanguageSelect.jsx";

export function TopBar() {
  const { user, ws, workspaces, envs, envId, theme, sidebarOpen } = useStore();
  const { set, setTheme, openWorkspace, createWorkspace, deleteEnvironment, logout, guard } = useStore.getState();
  const t = useT(), locale = useI18n((s) => s.locale);
  const more = useMenu(), userMenu = useMenu();
  const moreBtn = useRef(null), userBtn = useRef(null);
  const wsOptions = useMemo(() => [...workspaces.map((w) => ({ value: w.id, label: w.name, description: t(`role.${w.role}`), icon: "briefcase" })), { value: "+", label: t("top.newWorkspaceDots"), icon: "plus" }], [workspaces, locale]);
  const c = can(ws);
  const envOptions = useMemo(() => [{ value: "", label: t("top.noEnvironment"), icon: "ban" }, ...envs.map((e) => ({ value: e.id, label: e.name, icon: "layer-group", env: e })), ...(c.write ? [{ value: "+", label: t("top.newEnvironmentDots"), icon: "plus" }] : [])], [envs, locale, c.write]);
  return (
    <header className="top">
      <IconButton className="menu-btn" icon="bars" label={t("top.menu")} onClick={() => set({ sidebarOpen: !sidebarOpen })} />
      <div className="brand"><img className="logo" src="/logo.png" alt="" /><span className="brand-t">API Client</span></div>
      <Select className="ws-select" aria-label={t("top.workspace")} value={ws?.id} options={wsOptions} placeholder={t("top.noWorkspace")} onChange={(v) => (v === "+" ? createWorkspace() : openWorkspace(v))}
        renderOption={(o) => <><Icon name={o.icon} className="opt-icon" /><span className="opt-main"><span className="opt-label">{o.label}</span>{o.description && <span className="opt-desc">{o.description}</span>}</span></>} />
      {ws && <span className="role-badge">{t(`role.${ws.role}`)}</span>}
      <span className="grow" />
      {ws && (
        <>
          <Select className="env-select" aria-label={t("top.environment")} title={t("top.environment")} value={envId ?? ""} options={envOptions} renderOption={(o, { close: closeList }) => (o.env ? (
              <>
                <Icon name="layer-group" className="opt-icon" /><span className="opt-main"><span className="opt-label">{o.label}</span></span>
                {c.write && (
                  <span className="opt-acts">
                    <IconButton icon="pen" size="sm" label={t("env.editTitle")} onClick={(e) => { e.stopPropagation(); closeList(); modals.open((close) => <EnvFormModal close={close} env={o.env} />); }} />
                    <IconButton icon="trash-can" size="sm" label={t("env.deleteTitle")} onClick={(e) => { e.stopPropagation(); closeList(); deleteEnvironment(o.env); }} />
                  </span>
                )}
              </>
            ) : <><Icon name={o.icon} className="opt-icon" /><span className="opt-main"><span className="opt-label">{o.label}</span></span></>)}
            onChange={(v) => (v === "+" ? modals.open((close) => <EnvFormModal close={close} />) : set({ envId: v || null }))} renderValue={(o) => <><Icon name="layer-group" />{o.label}</>} />
          <IconButton ref={moreBtn} icon="ellipsis" label={t("top.more")} onClick={() => more.show(moreBtn.current)} />
          <Menu {...more} onClose={more.hide} placement="bottom-end" items={[
            { label: t("top.members"), icon: "users", onClick: () => modals.open((close) => <MembersModal close={close} />) },
            { label: t("top.importExport"), icon: "right-left", onClick: () => modals.open((close) => <InteropModal close={close} />) },
            { label: t("env.globals"), icon: "globe", onClick: () => modals.open((close) => <GlobalsModal close={close} />) },
          ]} />
        </>
      )}
      <LanguageSelect className="lang-select" size="sm" compact />
      <IconButton icon={theme === "dark" ? "sun" : "moon"} label={t("top.toggleTheme")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} />
      <button ref={userBtn} className="user-btn" aria-label={t("top.account")} onClick={() => userMenu.show(userBtn.current)}><Avatar name={user.name} src={user.avatar} size={30} /></button>
      <Menu {...userMenu} onClose={userMenu.hide} placement="bottom-end" items={[
        { label: `${user.name} (@${user.username})`, icon: "circle-user", disabled: true },
        { label: t("top.settings"), icon: "gear", onClick: () => set({ view: "settings" }) },
        ...(user.is_admin ? [{ label: t("top.adminPanel"), icon: "user-shield", onClick: () => set({ view: "admin" }) }] : []),
        "-",
        { label: t("top.signOut"), icon: "right-from-bracket", onClick: logout },
      ]} />
    </header>
  );
}
