import { useStore } from "../store.js";
import { cx } from "../lib/utils.js";
import { blankReq } from "../lib/http.js";
import { isLive, protocolOf } from "../lib/protocols.js";
import { useT } from "../i18n/index.js";
import { Icon } from "../components/ui/Icon.jsx";
import { IconButton } from "../components/ui/Button.jsx";

export function RequestTabs() {
  const t = useT();
  const tabs = useStore((s) => s.tabs), active = useStore((s) => s.active);
  const { activate, closeTab, addTab } = useStore.getState();
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <div key={tab.key} role="tab" aria-selected={tab.key === active} tabIndex={0} className={cx("tab", tab.key === active && "on")} onClick={() => activate(tab.key)} onAuxClick={(e) => e.button === 1 && closeTab(tab.key)} onKeyDown={(e) => e.key === "Enter" && activate(tab.key)} title={tab.req?.name ?? tab.name}>
          {tab.kind === "collection" ? <Icon name="folder" className="folder" /> : <span className={`m m-${isLive(tab.req) ? "proto" : tab.req.method}`}>{isLive(tab.req) ? protocolOf(tab.req.protocol).tag : tab.req.method}</span>}
          <span className="tab-name">{tab.req?.name ?? tab.name}</span>
          {tab.running && <Icon name="circle-notch" spin />}
          {tab.dirty && <span className="dirty" title={t("tabs.unsaved")}>●</span>}
          <button className="tab-x" aria-label={t("tabs.close", { name: tab.req?.name ?? tab.name })} onClick={(e) => { e.stopPropagation(); closeTab(tab.key); }}><Icon name="xmark" /></button>
        </div>
      ))}
      <IconButton icon="plus" label={t("tabs.newTab")} size="sm" onClick={() => addTab(blankReq())} />
    </div>
  );
}
