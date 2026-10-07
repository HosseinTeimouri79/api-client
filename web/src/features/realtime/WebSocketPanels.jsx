import { useState } from "react";
import { useStore } from "../../store.js";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useT } from "../../i18n/index.js";

const FORMATS = ["text", "base64", "hex"];

/** The "Message" tab: compose and send text or binary messages, ping, pong and close. */
export function WebSocketMessage({ tab }) {
  const t = useT();
  const { setReq, rtAct } = useStore.getState();
  const r = tab.req;
  const d = r.protocol_data ?? {};
  const open = tab.rt?.status === "open";
  const [payload, setPayload] = useState("");
  const [code, setCode] = useState("1000");
  const [reason, setReason] = useState("");
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const send = () => open && rtAct(tab.key, "send", { data: d.message ?? "", format: d.messageFormat ?? "text" });
  return (
    <div className="stack">
      <div className="row wrap">
        <Select value={d.messageFormat ?? "text"} options={FORMATS.map((f) => ({ value: f, label: t(`ws.format.${f}`) }))} onChange={(messageFormat) => patch({ messageFormat })} aria-label={t("ws.format")} />
        <span className="grow" />
        <Button variant="primary" icon="paper-plane" disabled={!open} title={open ? "Ctrl+Enter" : t("ws.needConnection")} onClick={send}>{t("ws.send")}</Button>
      </div>
      <textarea className="mono ws-compose" rows={8} spellCheck={false} placeholder={t("ws.messagePlaceholder")} aria-label={t("ws.message")} value={d.message ?? ""}
        onChange={(e) => patch({ message: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); send(); } }} />
      <div className="ws-controls">
        <div className="field grow"><span className="field-l">{t("ws.payload")}</span>
          <div className="row"><input value={payload} maxLength={125} onChange={(e) => setPayload(e.target.value)} aria-label={t("ws.payload")} />
            <Button disabled={!open} onClick={() => rtAct(tab.key, "ping", { data: payload })}>{t("ws.ping")}</Button>
            <Button disabled={!open} onClick={() => rtAct(tab.key, "pong", { data: payload })}>{t("ws.pong")}</Button></div></div>
        <div className="field"><span className="field-l">{t("ws.closeCode")} / {t("ws.closeReason")}</span>
          <div className="row"><input className="ws-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label={t("ws.closeCode")} />
            <input value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} aria-label={t("ws.closeReason")} />
            <Button variant="danger" disabled={!open} onClick={() => rtAct(tab.key, "close", { code: Number(code) || 1000, reason })}>{t("ws.close")}</Button></div></div>
      </div>
    </div>
  );
}

export function WebSocketSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  return (
    <div className="stack">
      <label className="field"><span className="field-l">{t("ws.subprotocols")}</span>
        <input value={d.subprotocols ?? ""} placeholder="graphql-ws, chat" onChange={(e) => setReq(tab.key, { protocol_data: { ...d, subprotocols: e.target.value } })} />
        <span className="field-h">{t("ws.subprotocolsHint")}</span></label>
    </div>
  );
}
