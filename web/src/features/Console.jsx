import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store.js";
import { cx } from "../lib/utils.js";
import { Icon } from "../components/ui/Icon.jsx";
import { Button, IconButton } from "../components/ui/Button.jsx";
import { Select } from "../components/ui/Select.jsx";
import { Splitter } from "../components/ui/Splitter.jsx";
import { useT } from "../i18n/index.js";

const RANK = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
export function Console() {
  const t = useT();
  const LEVELS = [{ value: "all", label: t("console.all") }, { value: "warn", label: t("console.warn") }, { value: "error", label: t("console.error") }];
  const { logs, consoleOpen, consoleH } = useStore();
  const { set, clearLogs } = useStore.getState();
  const [lvl, setLvl] = useState("all");
  const end = useRef(null);
  const shown = useMemo(() => logs.slice(-500).filter((l) => lvl === "all" || RANK[l.level] >= (lvl === "warn" ? 2 : 3)), [logs, lvl]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [shown, consoleOpen]);
  const errs = logs.filter((l) => l.level === "ERROR").length;
  return (
    <section className={cx("console", !consoleOpen && "closed")} style={consoleOpen ? { height: consoleH } : undefined}>
      {consoleOpen && <Splitter dir="row" className="console-split" onDrag={(d) => set((s) => ({ consoleH: Math.max(80, Math.min(innerHeight * 0.7, s.consoleH - d)) }))} onEnd={() => { try { localStorage.setItem("consoleH", String(useStore.getState().consoleH)); } catch { /* private mode */ } }} />}
      <div className="console-h">
        <button className="console-title" onClick={() => set({ consoleOpen: !consoleOpen })} aria-expanded={consoleOpen}><Icon name="terminal" /> {t("console.title")} {errs > 0 && <span className="count err">{errs}</span>}</button>
        <span className="grow" />
        {consoleOpen && <><Select size="sm" value={lvl} onChange={setLvl} options={LEVELS} aria-label={t("console.level")} /><Button size="sm" variant="ghost" icon="eraser" onClick={clearLogs}>{t("console.clear")}</Button></>}
        <IconButton icon={consoleOpen ? "chevron-down" : "chevron-up"} label={consoleOpen ? t("console.collapse") : t("console.expand")} size="sm" onClick={() => set({ consoleOpen: !consoleOpen })} />
      </div>
      {consoleOpen && (
        <div className="log">
          {shown.map((l, i) => (
            <div key={i} className={`L-${l.level}`}>{l.ts?.slice(11, 23)} [{l.level}] {l.message}{l.context && <span className="muted"> {JSON.stringify(l.context)}</span>}</div>
          ))}
          {!shown.length && <div className="muted">{t("console.empty", { api: "console.log" })}</div>}
          <div ref={end} />
        </div>
      )}
    </section>
  );
}
