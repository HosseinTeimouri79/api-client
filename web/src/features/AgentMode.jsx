import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { useT } from "../i18n/index.js";
import { Popover } from "../components/ui/Popover.jsx";
import { Button, IconButton } from "../components/ui/Button.jsx";
import { Field } from "../components/ui/Switch.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { toast } from "../components/ui/Toasts.jsx";
import { cx } from "../lib/utils.js";

// Where requests are sent from (Server or Local mode, see lib/transport.js) and the Local Agent's status, pairing and
// install instructions. The agent's state is checked every few seconds while Local mode is on.
const STATE = {
  off: "agent.state.off", checking: "agent.state.checking", connected: "agent.state.connected",
  unpaired: "agent.state.unpaired", unreachable: "agent.state.unreachable", forbidden: "agent.state.forbidden",
};
const TONE = { connected: "ok", checking: "warn", unpaired: "warn", unreachable: "err", forbidden: "err", off: "" };
const CLI = "api-client-agent";
const MANAGE = [
  { cmd: `${CLI} status`, key: "agent.cmd.status" },
  { cmd: `${CLI} pair`, key: "agent.cmd.pair" },
  { cmd: `${CLI} update`, key: "agent.cmd.update" },
  { cmd: `${CLI} uninstall`, key: "agent.cmd.uninstall" },
];

/** Re-checks the agent while Local mode is on: every 5 s, and when the window comes back into focus. */
export function useAgentWatch() {
  const mode = useStore((s) => s.execMode);
  useEffect(() => {
    if (mode !== "local") return;
    const check = () => document.visibilityState === "visible" && useStore.getState().checkAgent();
    const timer = setInterval(check, 5000);
    addEventListener("focus", check);
    return () => { clearInterval(timer); removeEventListener("focus", check); };
  }, [mode]);
}

const copy = (text, t) => navigator.clipboard?.writeText(text).then(() => toast(t("common.copied"), "ok"), () => toast(t("common.copyFailed"), "error"));

/** The agent's state in words, with what to do about it. */
function AgentStatus({ compact }) {
  const t = useT();
  const { agent, agentUrl, agentInfo } = useStore();
  const s = agent.state;
  const hint = {
    unreachable: t("agent.unreachableHint", { url: agentUrl, origin: location.origin }),
    unpaired: t("agent.unpairedHint"),
    forbidden: t("agent.forbiddenHint", { origin: location.origin }),
  }[s];
  return (
    <div className={cx("agent-status", compact && "compact")} role="status">
      <div className="row">
        <span className={cx("agent-dot", TONE[s])} />
        <b className={TONE[s]}>{t(STATE[s])}</b>
        {s === "connected" && agent.version && <span className="muted">{t("agent.version", { version: agent.version })}</span>}
        <span className="grow" />
        {!compact && <IconButton icon="rotate" size="sm" label={t("agent.refresh")} onClick={() => useStore.getState().checkAgent()} />}
      </div>
      {hint && <p className="muted agent-hint">{hint}</p>}
      {s === "connected" && agent.outdated && <p className="warn agent-hint">{t("agent.outdated", { version: agent.version, latest: agentInfo?.version })}</p>}
    </div>
  );
}

function PairForm() {
  const t = useT();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const error = await useStore.getState().pairAgent(code);
    setBusy(false);
    if (error) setErr(error); else setCode("");
  };
  return (
    <form className="stack agent-pair" onSubmit={submit}>
      <div className="row">
        <input dir="ltr" className="grow" value={code} maxLength={20} autoComplete="off" spellCheck={false} placeholder={t("agent.codePlaceholder")} aria-label={t("agent.code")} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Button type="submit" variant="primary" icon="link" loading={busy} disabled={code.replace(/[^A-Z0-9]/gi, "").length < 8}>{t("agent.pair")}</Button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </form>
  );
}

function ModeChoice({ value, onChange, disabled }) {
  const t = useT();
  const options = [
    { id: "server", icon: "server", label: t("mode.server"), hint: t("mode.serverHint") },
    { id: "local", icon: "laptop", label: t("mode.local"), hint: t("mode.localHint") },
  ];
  return (
    <div className="mode-choice" role="radiogroup" aria-label={t("mode.label")}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled && o.id === "local"} className={cx("mode-opt", value === o.id && "on")} onClick={() => onChange(o.id)}>
          <Icon name={o.icon} /><span className="opt-main"><span className="opt-label">{o.label}</span><span className="opt-desc">{o.hint}</span></span>
        </button>
      ))}
    </div>
  );
}

/** Header control: shows the mode and, in Local mode, the agent's state; opens a panel to switch and pair. */
export function ModeSwitch() {
  const t = useT();
  const { execMode, agent, agentInfo } = useStore();
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  if (!agentInfo?.enabled) return null;
  const local = execMode === "local";
  return (
    <>
      <button ref={btn} type="button" className={cx("mode-btn", local && "local")} aria-label={t("mode.label")} title={t("mode.label")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={local ? "laptop" : "server"} />
        <span className="mode-name">{t(local ? "mode.local" : "mode.server")}</span>
        {local && <span className={cx("agent-dot", TONE[agent.state])} aria-label={t(STATE[agent.state])} title={t(STATE[agent.state])} />}
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} placement="bottom-end" maxHeight={520} className="mode-pop">
        <div className="stack pad">
          <h3>{t("mode.label")}</h3>
          <ModeChoice value={execMode} onChange={(m) => useStore.getState().setExecMode(m)} />
          {local && <AgentStatus compact />}
          {local && ["unpaired", "unreachable"].includes(agent.state) && <PairForm />}
          <Button variant="ghost" icon="gear" onClick={() => { setOpen(false); useStore.setState({ view: "settings", settingsAt: { tab: "general", sub: "agent" } }); }}>{t("agent.settings")}</Button>
        </div>
      </Popover>
    </>
  );
}

// Like Field, but a <div>: inside a <label>, a click on the caption would press the first button (Copy, Pair).
const Group = ({ label, children }) => <div className="field"><span className="field-l">{label}</span>{children}</div>;

function Command({ text }) {
  const t = useT();
  return (
    <div className="agent-cmd">
      <code dir="ltr">{text}</code>
      <IconButton icon="copy" size="sm" label={t("common.copy")} onClick={() => copy(text, t)} />
    </div>
  );
}

// This computer's system, to put its installer first (the architecture of a Mac is not told to pages: both are shown).
const thisOs = () => {
  const p = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  return /win/.test(p) ? "win32" : /mac|iphone|ipad/.test(p) ? "darwin" : /linux|x11|cros/.test(p) ? "linux" : null;
};
const INSTALLER_LABEL = { exe: "agent.dl.win", pkg: "agent.dl.pkg", deb: "agent.dl.deb", "tar.gz": "agent.dl.tar" };
const ORDER = { exe: 0, pkg: 1, zip: 2, deb: 3, "tar.gz": 4 };
const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

/** Download buttons for the installers this server built (Node.js built in), the one for this computer first. */
function Installers({ list, server }) {
  const t = useT();
  const os = thisOs();
  const sorted = [...list].sort((a, b) => (b.platform === os) - (a.platform === os) || ORDER[a.kind] - ORDER[b.kind] || a.arch.localeCompare(b.arch));
  const label = (f) => (f.kind === "zip" ? t(f.arch === "arm64" ? "agent.dl.macArm" : "agent.dl.macIntel") : t(INSTALLER_LABEL[f.kind], { arch: f.arch }));
  return (
    <div className="stack">
      <p className="muted about">{t("agent.installersHint", { server })}</p>
      <div className="agent-dls">
        {sorted.map((f) => (
          <a key={f.url} className={cx("btn", f.platform === os ? "btn-primary" : "btn-default", "agent-dl")} href={f.url} download title={`SHA-256 ${f.sha256}`}>
            <Icon name="download" /><span className="btn-label">{label(f)}</span><span className="agent-dl-size">{mb(f.size)}</span>
            {f.platform === os && <span className="agent-dl-tag">{t("agent.forThis")}</span>}
          </a>
        ))}
      </div>
      {list.some((f) => f.kind === "zip") && <p className="muted about agent-hint">{t("agent.macNote")}</p>}
      {list.some((f) => f.kind === "deb") && <p className="muted about agent-hint">{t("agent.debNote")}</p>}
    </div>
  );
}

/** Settings → General → Local Agent */
export function AgentSettings() {
  const t = useT();
  const { execMode, agent, agentInfo, agentUrl } = useStore();
  const [url, setUrl] = useState(agentUrl);
  const [urlErr, setUrlErr] = useState("");
  useEffect(() => setUrl(agentUrl), [agentUrl]);
  if (!agentInfo?.enabled) return <p className="muted">{t("agent.disabled")}</p>;
  const server = agentInfo.server;
  const saveUrl = () => {
    if (url === agentUrl) return;
    if (useStore.getState().setAgentAddress(url)) setUrlErr("");
    else setUrlErr(t("agent.badUrl"));
  };
  return (
    <div className="stack agent-settings">
      <ModeChoice value={execMode} onChange={(m) => useStore.getState().setExecMode(m)} />

      <h4>{t("agent.status")}</h4>
      {execMode === "local" ? <AgentStatus /> : <p className="muted">{t("agent.state.off")}</p>}
      {execMode === "local" && ["unpaired", "unreachable"].includes(agent.state) && <Group label={t("agent.code")}><PairForm /></Group>}
      {execMode === "local" && agent.state === "connected" && <div><Button icon="link-slash" onClick={() => useStore.getState().unpairAgent()}>{t("agent.unpair")}</Button></div>}
      <Field label={t("agent.url")} hint={t("agent.urlHint", { url: agentInfo.defaultUrl })}>
        <input dir="ltr" value={url} aria-invalid={!!urlErr} onChange={(e) => setUrl(e.target.value)} onBlur={saveUrl} onKeyDown={(e) => e.key === "Enter" && saveUrl()} />
      </Field>
      {urlErr && <div className="err" role="alert">{urlErr}</div>}

      <h4>{t("agent.install")}</h4>
      {agentInfo.installers?.length ? <Installers list={agentInfo.installers} server={server} /> : <p className="muted about">{t("agent.noInstallers")}</p>}
      {agentInfo.available ? (
        <details className="agent-alt" open={!agentInfo.installers?.length}>
          <summary>{t("agent.orCommand")}</summary>
          <div className="stack">
            <Group label={t("agent.os.unix")}><Command text={`curl -fsSL ${server}/agent/install.sh | sh`} /></Group>
            <Group label={t("agent.os.windows")}><Command text={`powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${server}/agent/install.ps1 | iex"`} /></Group>
            <Group label={t("agent.os.manual")}>
              <Command text={`node agent.mjs install --server ${server}`} />
              <span className="field-h"><a href="/agent/agent.mjs" download>{t("agent.download")}</a> · SHA-256 <code dir="ltr" className="agent-sha">{agentInfo.sha256}</code></span>
            </Group>
          </div>
        </details>
      ) : !agentInfo.installers?.length && <p className="warn">{t("agent.notAvailable")}</p>}

      <h4>{t("agent.manage")}</h4>
      {MANAGE.map((m) => <Group key={m.cmd} label={t(m.key)}><Command text={m.cmd} /></Group>)}
      <p className="muted about agent-note"><Icon name="shield-halved" /> {t("agent.security")}</p>
    </div>
  );
}
