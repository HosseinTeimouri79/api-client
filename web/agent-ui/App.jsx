import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT, useI18n, LOCALES, applyLocale } from "../src/i18n/index.js";
import { Button, IconButton } from "../src/components/ui/Button.jsx";
import { Checkbox, Field } from "../src/components/ui/Switch.jsx";
import { Tabs } from "../src/components/ui/Tabs.jsx";
import { Icon, Spinner } from "../src/components/ui/Icon.jsx";
import { Toasts, toast } from "../src/components/ui/Toasts.jsx";
import { ModalHost } from "../src/components/ui/Modal.jsx";
import { confirm } from "../src/components/ui/dialogs.jsx";
import { Select } from "../src/components/ui/Select.jsx";
import { Flag } from "../src/components/ui/Flag.jsx";
import { cx } from "../src/lib/utils.js";
import { ui } from "./api.js";

const SECTIONS = ["overview", "sites", "network", "activity", "settings"];
const CLI = "api-client-agent";

// ---- small helpers ----
const readLs = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
export const initialTheme = () => readLs("agent-ui.theme") ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
function useAgo() {
  const locale = useI18n((s) => s.locale);
  return useCallback((iso) => {
    if (!iso) return null;
    const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, n] of [["day", 86400], ["hour", 3600], ["minute", 60]]) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
    return rtf.format(s, "second");
  }, [locale]);
}
const copy = async (text, t) => {
  try { await navigator.clipboard.writeText(text); toast(t("common.copied"), "ok"); } catch { toast(t("common.copyFailed"), "error"); }
};
/** "Mozilla/5.0 ... Chrome/130.0 Safari/537.36" -> "Chrome 130" (a paired site's label is the browser that paired it). */
function browserOf(label) {
  const ua = String(label ?? "");
  for (const [name, re] of [["Edge", /Edg\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Firefox", /Firefox\/(\d+)/], ["Chrome", /Chrome\/(\d+)/], ["Safari", /Version\/(\d+).*Safari/]]) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return ua.slice(0, 60) || null;
}
const ORDER = (state) => [...state.config.origins].sort((a, b) => (b === state.config.server) - (a === state.config.server) || a.localeCompare(b));

function Command({ text }) {
  const t = useT();
  return (
    <div className="agent-cmd">
      <code dir="ltr">{text}</code>
      <IconButton icon="copy" size="sm" label={t("common.copy")} onClick={() => copy(text, t)} />
    </div>
  );
}
function Toggle({ label, hint, checked, onChange, warn }) {
  return (
    <label className="toggle-row"><Checkbox checked={checked} onChange={onChange} label={label} />
      <span><span>{label}</span>{hint && <span className={cx("toggle-hint", warn ? "warn" : "muted")}>{hint}</span>}</span>
    </label>
  );
}
function Card({ title, icon, actions, children, className }) {
  return (
    <section className={cx("au-card", className)}>
      {(title || actions) && <div className="au-card-h">{title && <h2>{icon && <Icon name={icon} />}{title}</h2>}{actions && <div className="row">{actions}</div>}</div>}
      {children}
    </section>
  );
}

const LANGS = LOCALES.map((l) => ({ value: l.id, label: l.label, flag: l.flag, search: `${l.label} ${l.id}` }));
function LanguagePicker() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const row = (o) => <><Flag code={o.flag} /><span className="lang-name">{o.label}</span></>;
  return <Select size="sm" className="au-lang" aria-label={t("common.language")} title={t("common.language")} value={locale} options={LANGS} searchable onChange={(id) => applyLocale(id)}
    renderValue={(o) => <span className="lang-val compact">{row(o)}</span>} renderOption={(o) => <span className="lang-opt">{row(o)}</span>} />;
}
function ThemeToggle() {
  const t = useT();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);
  const flip = () => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; writeLs("agent-ui.theme", next); setTheme(next); };
  return <IconButton icon={theme === "dark" ? "sun" : "moon"} label={t("agentUi.theme")} onClick={flip} />;
}

// ---- the agent's state, polled; faster while a pairing code is waiting ----
function useAgent() {
  const [state, setState] = useState(null);
  const [problem, setProblem] = useState(null); // locked | unreachable | stopped | restarting
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const s = await ui("GET", "/state");
      setState(s);
      setProblem((p) => (p === "restarting" || p === "unreachable" || p === "locked" ? null : p));
      return s;
    } catch (e) {
      setProblem((p) => (p === "stopped" ? p : p === "restarting" && e.status === 0 ? p : e.status === 401 ? "locked" : e.status === 0 ? "unreachable" : p));
    } finally {
      busy.current = false;
    }
  }, []);
  return { state, setState, problem, setProblem, refresh };
}

export function App() {
  const t = useT();
  const agent = useAgent();
  const { state, problem, refresh } = agent;
  const [tab, setTab] = useState(() => (SECTIONS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview"));
  const [code, setCode] = useState(null); // { origin, code, expiresAt, before: [token ids] } shown until used or expired
  const expired = useMemo(() => location.hash === "#expired", []);
  const go = (id) => { setTab(id); history.replaceState(null, "", `#${id}`); };

  useEffect(() => {
    refresh();
    const tick = () => document.visibilityState === "visible" && refresh();
    const timer = setInterval(tick, code ? 1500 : 4000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [refresh, code]);
  // the pairing code was used: a new token for that site
  useEffect(() => {
    if (!code || !state) return;
    const fresh = state.tokens.find((x) => x.origin === code.origin && !code.before.includes(x.id));
    if (fresh) { setCode(null); toast(t("agentUi.pair.done", { site: code.origin }), "ok"); }
    else if (code.expiresAt < Date.now() || (!state.pairing && Date.now() - code.madeAt > 3000)) setCode(null);
  }, [state, code, t]);

  const actions = useMemo(() => ({
    async pair(origin) {
      try {
        const before = (agent.state?.tokens ?? []).filter((x) => x.origin === origin).map((x) => x.id);
        const r = await ui("POST", "/pair", { origin });
        setCode({ ...r, before, madeAt: Date.now() });
        refresh();
      } catch (e) { toast(errorText(t, e), "error"); }
    },
    async cancelPair() { setCode(null); try { agent.setState(await ui("POST", "/pair/cancel", {})); } catch { /* polled again */ } },
    async restart() {
      agent.setProblem("restarting");
      try { await ui("POST", "/restart", {}); } catch (e) { agent.setProblem(null); return toast(errorText(t, e), "error"); }
      const was = agent.state?.startedAt;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 750));
        const s = await refresh();
        if (s && s.startedAt !== was) { agent.setProblem(null); return toast(t("agentUi.restarted"), "ok"); }
      }
      agent.setProblem("unreachable");
    },
    async stop() {
      if (!(await confirm({ title: t("agentUi.stop.title"), message: t("agentUi.stop.message"), okText: t("agentUi.stop.ok") }))) return;
      try { await ui("POST", "/stop", {}); agent.setProblem("stopped"); } catch (e) { toast(errorText(t, e), "error"); }
    },
    async lock() {
      try { await ui("POST", "/logout", {}); } catch { /* locked anyway */ }
      agent.setProblem("locked");
    },
  }), [agent, refresh, t]);

  const items = SECTIONS.map((id) => ({ id, label: t(`agentUi.tab.${id}`) }));
  return (
    <div className="au">
      <header className="au-top">
        <img className="au-logo" src="/ui/logo.png" alt="" />
        <div className="au-name"><b>API Client Agent</b>{state && <span className="muted" dir="ltr">v{state.version}</span>}</div>
        {state && !problem && <span className="au-run"><span className="agent-dot ok" />{t("agentUi.running")}</span>}
        <span className="grow" />
        <LanguagePicker />
        <ThemeToggle />
        {state && !problem && <IconButton icon="lock" label={t("agentUi.lock")} onClick={actions.lock} />}
      </header>
      {problem ? <Problem kind={problem} expired={expired} /> : !state ? <div className="au-center"><Spinner /></div> : (
        <>
          <nav className="au-nav"><Tabs items={items} value={tab} onChange={go} /></nav>
          <main className="au-main">
            {tab === "overview" && <Overview state={state} code={code} actions={actions} go={go} agent={agent} />}
            {tab === "sites" && <Sites state={state} code={code} actions={actions} agent={agent} />}
            {tab === "network" && <Network state={state} agent={agent} />}
            {tab === "activity" && <Activity state={state} />}
            {tab === "settings" && <Settings state={state} agent={agent} actions={actions} />}
          </main>
        </>
      )}
      <Toasts />
      <ModalHost />
    </div>
  );
}

// errors from the page API: known ones translated, the rest as they are
const KNOWN = { "not-an-address": "agentUi.err.address", self: "agentUi.err.self", "unknown-site": "agentUi.err.unknownSite", "not-managed": "agentUi.err.notManaged", unreachable: "agentUi.problem.unreachable" };
const errorText = (t, e) => (KNOWN[e.message] ? t(KNOWN[e.message]) : e.message);

function Problem({ kind, expired }) {
  const t = useT();
  const view = {
    locked: { icon: "lock", title: t("agentUi.problem.locked"), text: expired ? t("agentUi.problem.expired") : t("agentUi.problem.lockedHint"), cmd: `${CLI} ui` },
    unreachable: { icon: "plug-circle-xmark", title: t("agentUi.problem.unreachable"), text: t("agentUi.problem.unreachableHint"), cmd: `${CLI} start` },
    stopped: { icon: "circle-stop", title: t("agentUi.problem.stopped"), text: t("agentUi.problem.stoppedHint"), cmd: `${CLI} start` },
    restarting: { icon: "rotate", title: t("agentUi.problem.restarting"), text: t("agentUi.problem.restartingHint"), spin: true },
  }[kind];
  return (
    <div className="au-center">
      <div className="au-problem stack">
        <Icon name={view.icon} spin={view.spin} className="au-problem-i" />
        <h1>{view.title}</h1>
        <p className="muted">{view.text}</p>
        {view.cmd && <Command text={view.cmd} />}
      </div>
    </div>
  );
}

// ---- adding a site and pairing it ----
function AddSite({ agent, onAdded, big }) {
  const t = useT();
  const [address, setAddress] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e?.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    try {
      const r = await ui("POST", "/sites", { address });
      agent.setState(r.state);
      setAddress(""); setErr("");
      onAdded?.(r.origin);
    } catch (e2) { setErr(errorText(t, e2)); } finally { setBusy(false); }
  };
  return (
    <form className={cx("au-add", big && "au-add-big")} onSubmit={add}>
      <Field label={t("agentUi.site.address")} hint={t("agentUi.site.addressHint")}>
        <div className="row">
          <input dir="ltr" className="grow" value={address} placeholder="https://api.example.com" aria-invalid={!!err} onChange={(e) => setAddress(e.target.value)} />
          <Button type="submit" variant="primary" icon="plus" loading={busy}>{t("agentUi.site.add")}</Button>
        </div>
      </Field>
      {err && <div className="err" role="alert">{err}</div>}
    </form>
  );
}
function PairPanel({ code, actions }) {
  const t = useT();
  const now = useNow();
  const left = Math.max(0, Math.round((code.expiresAt - now) / 1000));
  return (
    <div className="au-pair" role="status">
      <div className="au-pair-code" dir="ltr" aria-label={t("agentUi.pair.code")}>{code.code}</div>
      <div className="row wrap au-pair-meta">
        <span className="muted"><Icon name="clock" /> {t("agentUi.pair.expires", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</span>
        <Button size="sm" icon="copy" onClick={() => copy(code.code, t)}>{t("common.copy")}</Button>
        <Button size="sm" variant="ghost" onClick={actions.cancelPair}>{t("common.cancel")}</Button>
      </div>
      <ol className="au-steps">
        <li>{t("agentUi.pair.step1")} <a href={code.origin} target="_blank" rel="noreferrer" dir="ltr">{code.origin} <Icon name="arrow-up-right-from-square" /></a></li>
        <li>{t("agentUi.pair.step2")}</li>
        <li>{t("agentUi.pair.step3")}</li>
      </ol>
      <p className="muted au-wait"><Spinner /> {t("agentUi.pair.waiting")}</p>
    </div>
  );
}

// ---- Overview ----
function Overview({ state, code, actions, go, agent }) {
  const t = useT();
  const ago = useAgo();
  const paired = new Set(state.tokens.map((x) => x.origin));
  const first = !state.config.origins.length;
  return (
    <div className="au-grid">
      {first && (
        <Card title={t("agentUi.welcome.title")} icon="hand" className="au-welcome">
          <p className="muted about">{t("agentUi.welcome.text")}</p>
          <AddSite big agent={agent} onAdded={(origin) => actions.pair(origin)} />
        </Card>
      )}
      {code && <Card title={t("agentUi.pair.title", { site: code.origin })} icon="link"><PairPanel code={code} actions={actions} /></Card>}
      {!first && !code && state.config.origins.some((o) => !paired.has(o)) && (
        <Card title={t("agentUi.unpaired.title")} icon="link-slash">
          {ORDER(state).filter((o) => !paired.has(o)).map((o) => (
            <div key={o} className="row between au-line"><span dir="ltr" className="au-origin">{o}</span><Button size="sm" variant="primary" icon="key" onClick={() => actions.pair(o)}>{t("agentUi.site.pair")}</Button></div>
          ))}
        </Card>
      )}
      <Card title={t("agentUi.status.title")} icon="heart-pulse">
        <dl className="about-dl au-dl">
          <dt>{t("agentUi.status.state")}</dt><dd><span className="agent-dot ok" /> {t("agentUi.running")} <span className="muted">({t("agentUi.status.since", { time: ago(state.startedAt) })})</span></dd>
          <dt>{t("agentUi.status.address")}</dt><dd><code dir="ltr">http://127.0.0.1:{state.port}</code></dd>
          <dt>{t("agentUi.status.version")}</dt><dd><span dir="ltr">{state.version}</span></dd>
          <dt>{t("agentUi.status.system")}</dt><dd><span dir="ltr">{state.platform}-{state.arch} · Node.js {state.node}</span></dd>
          <dt>{t("agentUi.status.sites")}</dt><dd><a href="#sites" onClick={(e) => { e.preventDefault(); go("sites"); }}>{t("agentUi.status.sitesValue", { sites: state.config.origins.length, paired: paired.size })}</a></dd>
          <dt>{t("agentUi.status.busy")}</dt><dd>{t("agentUi.status.busyValue", { requests: state.inFlight, connections: state.sessions })}</dd>
          <dt>{t("agentUi.status.service")}</dt><dd>{state.managed ? t("agentUi.status.managed") : t("agentUi.status.manual")}</dd>
        </dl>
        <div className="row wrap">
          {state.managed && <Button icon="rotate" onClick={actions.restart}>{t("agentUi.restart")}</Button>}
          <Button variant="danger" icon="circle-stop" onClick={actions.stop}>{t("agentUi.stop.ok")}</Button>
        </div>
      </Card>
      <Updates state={state} actions={actions} />
    </div>
  );
}

function Updates({ state, actions }) {
  const t = useT();
  const [check, setCheck] = useState(null); // { available, latest } | { error }
  const [busy, setBusy] = useState("");
  const run = async () => {
    setBusy("check");
    try { setCheck(await ui("POST", "/update/check", {})); } catch (e) { setCheck({ error: errorText(t, e) }); } finally { setBusy(""); }
  };
  const update = async () => {
    setBusy("update");
    try {
      const r = await ui("POST", "/update", {});
      if (!r.updated) { toast(t("agentUi.update.none"), "ok"); return; }
      if (r.restarting) { toast(t("agentUi.update.done", { version: r.version }), "ok"); actions.restart(); }
      else setCheck({ installed: r.version });
    } catch (e) { setCheck({ error: errorText(t, e) }); } finally { setBusy(""); }
  };
  return (
    <Card title={t("agentUi.update.title")} icon="cloud-arrow-down">
      {state.packaged ? <p className="muted about">{t("agentUi.update.packaged")}</p> : (
        <>
          <p className="muted about">{state.config.server ? t("agentUi.update.source", { site: state.config.server }) : t("agentUi.update.noSource")}</p>
          {check?.error && <p className="err about" role="alert">{check.error}</p>}
          {check && !check.error && !check.installed && <p className="about">{check.available ? t("agentUi.update.available", { version: check.latest }) : t("agentUi.update.upToDate", { version: state.version })}</p>}
          {check?.installed && <p className="warn about">{t("agentUi.update.installedRestart", { version: check.installed })}</p>}
          <div className="row wrap">
            <Button icon="magnifying-glass" loading={busy === "check"} disabled={!state.config.server || !!busy} onClick={run}>{t("agentUi.update.check")}</Button>
            {check?.available && state.canUpdate && <Button variant="primary" icon="download" loading={busy === "update"} disabled={!!busy} onClick={update}>{t("agentUi.update.now", { version: check.latest })}</Button>}
          </div>
        </>
      )}
    </Card>
  );
}

// ---- Sites ----
function Sites({ state, code, actions, agent }) {
  const t = useT();
  const ago = useAgo();
  const remove = async (origin) => {
    if (!(await confirm({ title: t("agentUi.site.removeTitle"), message: t("agentUi.site.removeMessage", { site: origin }), okText: t("common.remove") }))) return;
    try { agent.setState(await ui("POST", "/sites/remove", { origin })); } catch (e) { toast(errorText(t, e), "error"); }
  };
  const revoke = async (tok) => {
    if (!(await confirm({ title: t("agentUi.token.revokeTitle"), message: t("agentUi.token.revokeMessage", { site: tok.origin }), okText: t("agentUi.token.revoke") }))) return;
    try { agent.setState(await ui("POST", "/tokens/revoke", { id: tok.id })); } catch (e) { toast(errorText(t, e), "error"); }
  };
  return (
    <div className="au-grid">
      <Card title={t("agentUi.site.addTitle")} icon="plus">
        <p className="muted about">{t("agentUi.site.intro")}</p>
        <AddSite agent={agent} onAdded={(origin) => actions.pair(origin)} />
      </Card>
      {!state.config.origins.length && <p className="muted au-empty">{t("agentUi.site.none")}</p>}
      {ORDER(state).map((origin) => {
        const tokens = state.tokens.filter((x) => x.origin === origin);
        return (
          <Card key={origin} className="au-site" title={<span dir="ltr" className="au-origin">{origin}</span>} icon="globe"
            actions={<>
              <Button size="sm" variant={tokens.length ? "default" : "primary"} icon="key" onClick={() => actions.pair(origin)}>{t("agentUi.site.pair")}</Button>
              <Button size="sm" variant="danger" icon="trash" onClick={() => remove(origin)}>{t("common.remove")}</Button>
            </>}>
            <div className="row wrap au-badges">
              <a href={origin} target="_blank" rel="noreferrer">{t("agentUi.site.open")} <Icon name="arrow-up-right-from-square" /></a>
              {origin === state.config.server && <span className="au-badge"><Icon name="cloud-arrow-down" /> {t("agentUi.site.updates")}</span>}
            </div>
            {code?.origin === origin && <PairPanel code={code} actions={actions} />}
            {tokens.length ? (
              <ul className="au-tokens">
                {tokens.map((tok) => (
                  <li key={tok.id}>
                    <Icon name="key" className="muted" />
                    <span className="grow">
                      <span className="au-tok-name">{browserOf(tok.label) ?? t("agentUi.token.unknown")}</span>
                      <span className="muted au-tok-meta">{t("agentUi.token.meta", { paired: ago(tok.createdAt), used: tok.lastUsedAt ? ago(tok.lastUsedAt) : t("agentUi.token.never") })}</span>
                    </span>
                    <Button size="sm" variant="ghost" icon="link-slash" onClick={() => revoke(tok)}>{t("agentUi.token.revoke")}</Button>
                  </li>
                ))}
              </ul>
            ) : code?.origin !== origin && <p className="muted about">{t("agentUi.site.notPaired")}</p>}
          </Card>
        );
      })}
    </div>
  );
}

// ---- Network access ----
const lines = (s) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
function Network({ state, agent }) {
  const t = useT();
  const saved = state.config.targets;
  const [form, setForm] = useState(() => ({ ...saved, allow: saved.allow.join("\n"), deny: saved.deny.join("\n") }));
  const [bad, setBad] = useState([]);
  const [busy, setBusy] = useState(false);
  const value = { public: form.public, private: form.private, loopback: form.loopback, linkLocal: form.linkLocal, allow: lines(form.allow), deny: lines(form.deny) };
  const dirty = JSON.stringify(value) !== JSON.stringify({ public: saved.public, private: saved.private, loopback: saved.loopback, linkLocal: saved.linkLocal, allow: saved.allow, deny: saved.deny });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { agent.setState(await ui("POST", "/targets", value)); setBad([]); toast(t("agentUi.net.saved"), "ok"); }
    catch (e) { if (e.entries) setBad(e.entries); else toast(errorText(t, e), "error"); }
    finally { setBusy(false); }
  };
  const reset = () => { setForm({ ...saved, allow: saved.allow.join("\n"), deny: saved.deny.join("\n") }); setBad([]); };
  return (
    <div className="au-grid">
      <Card title={t("agentUi.net.title")} icon="network-wired">
        <p className="muted about">{t("agentUi.net.intro")}</p>
        <div className="stack">
          <Toggle label={t("agentUi.net.public")} hint={t("agentUi.net.publicHint")} checked={form.public} onChange={set("public")} />
          <Toggle label={t("agentUi.net.private")} hint={t("agentUi.net.privateHint")} checked={form.private} onChange={set("private")} />
          <Toggle label={t("agentUi.net.loopback")} hint={t("agentUi.net.loopbackHint")} checked={form.loopback} onChange={set("loopback")} />
          <Toggle label={t("agentUi.net.linkLocal")} hint={t("agentUi.net.linkLocalHint")} checked={form.linkLocal} onChange={set("linkLocal")} warn={form.linkLocal} />
        </div>
      </Card>
      <Card title={t("agentUi.net.rules")} icon="filter">
        <div className="au-two">
          <Field label={t("agentUi.net.allow")} hint={t("agentUi.net.allowHint")}>
            <textarea className="mono" dir="ltr" rows={5} value={form.allow} placeholder={"*.corp.local\n10.0.0.0/8"} onChange={(e) => set("allow")(e.target.value)} />
          </Field>
          <Field label={t("agentUi.net.deny")} hint={t("agentUi.net.denyHint")}>
            <textarea className="mono" dir="ltr" rows={5} value={form.deny} placeholder={"192.168.1.1\nprinter.local"} onChange={(e) => set("deny")(e.target.value)} />
          </Field>
        </div>
        {bad.length > 0 && <div className="err" role="alert">{t("agentUi.net.bad", { entries: bad.join(", ") })}</div>}
      </Card>
      <div className="row end au-save">
        <span className="muted mr-auto">{t("agentUi.net.applies")}</span>
        <Button disabled={!dirty || busy} onClick={reset}>{t("agentUi.reset")}</Button>
        <Button variant="primary" icon="check" disabled={!dirty} loading={busy} onClick={save}>{t("common.save")}</Button>
      </div>
    </div>
  );
}

// ---- Activity ----
function Activity({ state }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [items, setItems] = useState([]);
  const last = useRef({ seq: 0, startedAt: state.startedAt });
  useEffect(() => {
    let live = true;
    const poll = async () => {
      if (last.current.startedAt !== state.startedAt) { last.current = { seq: 0, startedAt: state.startedAt }; setItems([]); } // restarted: a new list
      try {
        const got = await ui("GET", `/activity?since=${last.current.seq}`);
        if (!live || !got.length) return;
        last.current.seq = got.at(-1).seq;
        setItems((xs) => [...got.reverse(), ...xs].slice(0, 300));
      } catch { /* the state poll shows what is wrong */ }
    };
    poll();
    const timer = setInterval(() => document.visibilityState === "visible" && poll(), 2500);
    return () => { live = false; clearInterval(timer); };
  }, [state.startedAt]);
  const time = (iso) => new Date(iso).toLocaleTimeString(locale);
  const what = (e) => {
    if (e.kind === "request") return <span dir="ltr"><b className={`m-${e.method}`}>{e.method}</b> {e.target}</span>;
    if (e.kind === "connection") return <span dir="ltr"><b>{String(e.protocol).toUpperCase()}</b> {e.target}</span>;
    if (e.kind === "refused") return e.reason === "page" ? t("agentUi.act.refusedPage") : t("agentUi.act.refusedSite");
    return t(`agentUi.act.${e.kind}`);
  };
  const result = (e) => {
    if (e.status != null) return <span className={cx("au-status", e.status >= 500 ? "err" : e.status >= 400 ? "warn" : "ok")} dir="ltr">{e.status}<span className="muted"> · {e.ms} ms</span></span>;
    if (e.error) return <span className="err" title={e.message} dir="ltr">{e.error}</span>;
    if (e.kind === "refused" || e.kind === "pairing-failed") return <span className="err">{t("agentUi.act.blocked")}</span>;
    return <span className="ok"><Icon name="check" /></span>;
  };
  return (
    <div className="au-grid">
      <Card title={t("agentUi.act.title")} icon="list-ul" actions={items.length > 0 && <Button size="sm" variant="ghost" icon="broom" onClick={() => setItems([])}>{t("agentUi.act.clear")}</Button>}>
        <p className="muted about">{t("agentUi.act.intro")}</p>
        {items.length ? (
          <div className="agent-dl-wrap au-act-wrap">
            <table className="agent-dls au-act">
              <thead><tr><th>{t("agentUi.act.time")}</th><th>{t("agentUi.act.site")}</th><th>{t("agentUi.act.what")}</th><th>{t("agentUi.act.result")}</th></tr></thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.seq}>
                    <td className="au-nowrap muted" dir="ltr">{time(e.at)}</td>
                    <td className="au-site-cell" dir="ltr">{e.site ?? "—"}</td>
                    <td className="au-what">{what(e)}</td>
                    <td className="au-nowrap">{result(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted au-empty">{t("agentUi.act.none")}</p>}
      </Card>
    </div>
  );
}

// ---- Settings ----
const MB = 1024 * 1024;
function Settings({ state, agent, actions }) {
  const t = useT();
  const c = state.config;
  const initial = () => ({ port: String(c.port), timeout: String(Math.round(c.limits.maxTimeoutMs / 1000)), response: String(Math.round(c.limits.maxResponseBytes / MB)), concurrent: String(c.limits.maxConcurrent), sessions: String(c.limits.maxSessions), autoUpdate: c.autoUpdate });
  const [form, setForm] = useState(initial);
  const [restart, setRestart] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: typeof e === "boolean" ? e : e.target.value }));
  const body = { port: Number(form.port), autoUpdate: form.autoUpdate, limits: { maxTimeoutMs: Number(form.timeout) * 1000, maxResponseBytes: Number(form.response) * MB, maxConcurrent: Number(form.concurrent), maxSessions: Number(form.sessions) } };
  const dirty = JSON.stringify(initial()) !== JSON.stringify(form);
  const save = async () => {
    setBusy(true);
    try {
      const r = await ui("POST", "/settings", body);
      agent.setState(r.state);
      setRestart(r.restart);
      setErr("");
      toast(t("common.saved"), "ok");
    } catch (e) { setErr(e.message === "Validation failed" ? t("agentUi.set.invalid") : errorText(t, e)); } finally { setBusy(false); }
  };
  const num = (k, label, hint, min, max) => (
    <Field label={label} hint={hint}><input type="number" dir="ltr" min={min} max={max} value={form[k]} onChange={set(k)} /></Field>
  );
  const pending = restart;
  return (
    <div className="au-grid">
      {pending && (
        <div className="au-banner warn" role="status">
          <Icon name="rotate" /> <span className="grow">{t("agentUi.set.restartNeeded")}</span>
          {state.managed ? <Button size="sm" variant="primary" icon="rotate" onClick={actions.restart}>{t("agentUi.restart")}</Button> : <code dir="ltr">{CLI} restart</code>}
        </div>
      )}
      <Card title={t("agentUi.set.title")} icon="sliders">
        <div className="au-two">
          {num("port", t("agentUi.set.port"), t("agentUi.set.portHint"), 1024, 65535)}
          {num("timeout", t("agentUi.set.timeout"), t("agentUi.set.timeoutHint"), 1, 3600)}
          {num("response", t("agentUi.set.response"), t("agentUi.set.responseHint"), 1, 1024)}
          {num("concurrent", t("agentUi.set.concurrent"), t("agentUi.set.concurrentHint"), 1, 256)}
          {num("sessions", t("agentUi.set.sessions"), t("agentUi.set.sessionsHint"), 1, 200)}
        </div>
        {!state.packaged && <Toggle label={t("agentUi.set.autoUpdate")} hint={t("agentUi.set.autoUpdateHint")} checked={form.autoUpdate} onChange={set("autoUpdate")} />}
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row end">
          <Button disabled={!dirty || busy} onClick={() => setForm(initial())}>{t("agentUi.reset")}</Button>
          <Button variant="primary" icon="check" disabled={!dirty} loading={busy} onClick={save}>{t("common.save")}</Button>
        </div>
      </Card>
      {state.paths && (
        <Card title={t("agentUi.files.title")} icon="folder-open">
          <Field label={t("agentUi.files.config")}><Command text={state.paths.config} /></Field>
          <Field label={t("agentUi.files.logs")}><Command text={state.paths.logs} /></Field>
          {!state.packaged && <Field label={t("agentUi.files.program")}><Command text={state.paths.install} /></Field>}
        </Card>
      )}
      <Card title={t("agentUi.remove.title")} icon="trash">
        <p className="muted about">{state.packaged ? t("agentUi.remove.packaged") : t("agentUi.remove.text")}</p>
        <Command text={state.packaged ? "sudo apt remove api-client-agent" : `${CLI} uninstall`} />
      </Card>
    </div>
  );
}
