import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store.js";
import { cx, fmtBytes } from "../../lib/utils.js";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Icon, Spinner } from "../../components/ui/Icon.jsx";
import { toast } from "../../components/ui/Toasts.jsx";
import { highlightJson } from "../../lib/highlight.jsx";
import { t as tr, useT } from "../../i18n/index.js";

const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast(tr("common.copied"), "ok"), () => toast(tr("common.copyFailed"), "error"));
const isMessage = (e) => e.type === "message";
const KINDS = { all: () => true, sent: (e) => e.direction === "out", received: (e) => e.direction === "in" && e.type !== "closed", events: (e) => !isMessage(e) };
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });

function pretty(data) {
  try {
    const v = JSON.parse(data);
    if (v && typeof v === "object") return JSON.stringify(v, null, 2);
  } catch { /* not JSON */ }
  return null;
}

function Entry({ e }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const message = isMessage(e) || e.type === "ping" || e.type === "pong";
  const json = isMessage(e) && !e.binary ? pretty(e.data) : null;
  const label = t(`rt.ev.${e.type}`);
  const head = e.type === "closed" ? [e.code && `${e.code}`, e.reason].filter(Boolean).join(" ") || e.reason : e.type === "error" ? e.message : e.type === "open" ? e.url : e.type === "closing" ? `${e.code} ${e.reason}`.trim() : null;
  const text = message ? (e.binary ? e.data : e.data) : head;
  return (
    <div className={cx("ev", `ev-${e.type}`, e.direction && `ev-${e.direction}`)}>
      <div className="ev-row" onClick={() => message && setOpen(!open)} role={message ? "button" : undefined}>
        <span className="ev-dir" title={e.direction === "out" ? t("rt.sent") : e.direction === "in" ? t("rt.received") : label}>
          <Icon name={e.direction === "out" ? "arrow-up" : e.direction === "in" ? "arrow-down" : e.type === "error" ? "triangle-exclamation" : "circle-info"} />
        </span>
        {!isMessage(e) && <span className="ev-badge">{label}</span>}
        {e.binary && <span className="ev-badge bin">{t("rt.binary")}</span>}
        <span className="ev-text">{text || <i className="muted">{t("rt.emptyMessage")}</i>}</span>
        {e.size != null && <span className="ev-size">{fmtBytes(e.size)}</span>}
        <span className="ev-time">{clock(e.ts)}</span>
      </div>
      {open && message && (
        <div className="ev-detail">
          <pre className="raw">{json ? highlightJson(json) : e.data}</pre>
          <Button size="sm" icon="copy" onClick={() => copy(e.data)}>{t("common.copy")}</Button>
        </div>
      )}
    </div>
  );
}

/** The right-hand pane of a live tab: connection state, handshake and the stream of events. */
export function EventLog({ tab }) {
  const t = useT();
  const clearEvents = useStore((s) => s.clearEvents);
  const rt = tab.rt;
  const [view, setView] = useState("events");
  const [kind, setKind] = useState("all");
  const box = useRef(null);
  const stick = useRef(true);
  const status = rt?.status ?? "idle";
  const events = rt?.events ?? [];
  const shown = useMemo(() => events.filter(KINDS[kind]), [events, kind]);
  const opened = events.find((e) => e.type === "open");
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, view]);
  const bar = [
    { id: "events", label: t("rt.messages"), badge: events.filter(isMessage).length || false },
    { id: "handshake", label: t("rt.handshake") },
  ];
  return (
    <div className="resp rt-log">
      <div className="resp-meta">
        <span className={cx("rt-state", `s-${status}`)}><i />{t(`rt.status.${status}`)}</span>
        {status === "connecting" && <Spinner />}
        {opened?.protocol && <span className="muted">{t("rt.subprotocol", { name: opened.protocol })}</span>}
        {rt?.error && <span className="err">{rt.error.message}</span>}
      </div>
      <div className="resp-bar">
        <Tabs items={bar} value={view} onChange={setView} />
        {view === "events" && (
          <>
            <Tabs variant="pill" items={Object.keys(KINDS).map((k) => ({ id: k, label: t(`rt.filter.${k}`) }))} value={kind} onChange={setKind} />
            <Button size="sm" icon="eraser" onClick={() => clearEvents(tab.key)} disabled={!events.length}>{t("rt.clear")}</Button>
          </>
        )}
      </div>
      {view === "events" ? (
        <div className="ev-list" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
          {shown.map((e) => <Entry key={e.seq} e={e} />)}
          {!shown.length && <div className="empty-mini"><Icon name="plug" className="big" /><p>{status === "open" ? t("rt.emptyOpen") : status === "idle" ? t("rt.empty") : events.length ? t("rt.noMatch") : ""}</p></div>}
        </div>
      ) : (
        <div className="stack pad">
          {rt?.error?.status && <div className="note"><Icon name="circle-info" /> {rt.error.message}</div>}
          {opened ? (<><div className="sent-line"><code>{opened.url}</code><span className="ok">{opened.status}</span></div>
            <table className="htable"><tbody>{opened.headers.map((h, i) => <tr key={i}><th>{h.key}</th><td>{h.value}</td></tr>)}</tbody></table></>) :
            rt?.error?.headers?.length ? <table className="htable"><tbody>{rt.error.headers.map((h, i) => <tr key={i}><th>{h.key}</th><td>{h.value}</td></tr>)}</tbody></table> :
            <div className="muted">{t("rt.noHandshake")}</div>}
        </div>
      )}
    </div>
  );
}
