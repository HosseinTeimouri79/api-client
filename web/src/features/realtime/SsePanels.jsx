import { useState } from "react";
import { useStore } from "../../store.js";
import { Checkbox, Field } from "../../components/ui/Switch.jsx";
import { useT } from "../../i18n/index.js";

export function SseSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const [max, setMax] = useState(String(d.maxReconnects ?? 10));
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  return (
    <div className="stack">
      <label className="row"><Checkbox checked={!!d.reconnect} onChange={(reconnect) => patch({ reconnect })} label={t("sse.reconnect")} /> <span>{t("sse.reconnect")}</span></label>
      <span className="field-h">{t("sse.reconnectHint")}</span>
      <Field label={t("sse.maxReconnects")}>
        <input inputMode="numeric" className="short" value={max} disabled={!d.reconnect} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 4); setMax(v); patch({ maxReconnects: Number(v) || 0 }); }} />
      </Field>
    </div>
  );
}
