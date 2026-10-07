import { useState } from "react";
import { useStore } from "../../store.js";
import { Select } from "../../components/ui/Select.jsx";
import { Checkbox, Field } from "../../components/ui/Switch.jsx";
import { useT } from "../../i18n/index.js";

const MODES = ["client", "listen"];

export function UdpSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const [port, setPort] = useState(String(d.bindPort ?? 0));
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const listen = d.mode === "listen";
  return (
    <div className="stack">
      <Field label={t("udp.mode")} hint={t("udp.modeHint")}>
        <Select value={d.mode ?? "client"} options={MODES.map((m) => ({ value: m, label: t(`udp.mode.${m}`) }))} onChange={(mode) => patch({ mode })} aria-label={t("udp.mode")} />
      </Field>
      {listen ? (
        <Field label={t("udp.bindPort")} hint={t("udp.bindPortHint")}>
          <input inputMode="numeric" className="short" value={port} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 5); setPort(v); patch({ bindPort: Number(v) || 0 }); }} />
        </Field>
      ) : (
        <>
          <label className="row"><Checkbox checked={d.onlyFromTarget !== false} onChange={(onlyFromTarget) => patch({ onlyFromTarget })} label={t("udp.onlyFromTarget")} /> <span>{t("udp.onlyFromTarget")}</span></label>
          <span className="field-h">{t("udp.onlyFromTargetHint")}</span>
        </>
      )}
    </div>
  );
}
