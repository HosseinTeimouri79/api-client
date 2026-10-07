import { useStore } from "../store.js";
import { cx } from "../lib/utils.js";
import { blankReq } from "../lib/http.js";
import { Icon } from "../components/ui/Icon.jsx";
import { IconButton } from "../components/ui/Button.jsx";

export function RequestTabs() {
  const tabs = useStore((s) => s.tabs), active = useStore((s) => s.active);
  const { activate, closeTab, addTab } = useStore.getState();
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <div key={t.key} role="tab" aria-selected={t.key === active} tabIndex={0} className={cx("tab", t.key === active && "on")} onClick={() => activate(t.key)} onAuxClick={(e) => e.button === 1 && closeTab(t.key)} onKeyDown={(e) => e.key === "Enter" && activate(t.key)} title={t.req?.name ?? t.name}>
          {t.kind === "collection" ? <Icon name="folder" className="folder" /> : <span className={`m m-${t.req.method}`}>{t.req.method}</span>}
          <span className="tab-name">{t.req?.name ?? t.name}</span>
          {t.running && <Icon name="circle-notch" spin />}
          {t.dirty && <span className="dirty" title="Unsaved changes">●</span>}
          <button className="tab-x" aria-label={`Close ${t.req?.name ?? t.name}`} onClick={(e) => { e.stopPropagation(); closeTab(t.key); }}><Icon name="xmark" /></button>
        </div>
      ))}
      <IconButton icon="plus" label="New request tab (Ctrl+T)" size="sm" onClick={() => addTab(blankReq())} />
    </div>
  );
}
