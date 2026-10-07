import { useStore } from "../../store.js";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox, Field } from "../../components/ui/Switch.jsx";
import { useT } from "../../i18n/index.js";

const FORMATS = ["text", "base64", "hex"];
const ENDINGS = ["none", "lf", "crlf"];

/** The "Message" tab of a TCP connection: bytes to send as text (with an optional line ending), base64 or hex. */
export function TcpMessage({ tab }) {
  const t = useT();
  const { setReq, rtAct } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const open = tab.rt?.status === "open";
  const format = d.messageFormat ?? "text";
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const send = () => open && rtAct(tab.key, "send", { data: d.message ?? "", format, lineEnding: d.lineEnding ?? "none" });
  return (
    <div className="stack">
      <div className="row wrap">
        <Select value={format} options={FORMATS.map((f) => ({ value: f, label: t(`ws.format.${f}`) }))} onChange={(messageFormat) => patch({ messageFormat })} aria-label={t("ws.format")} />
        {format === "text" && <Select value={d.lineEnding ?? "none"} options={ENDINGS.map((e) => ({ value: e, label: t(`tcp.lineEnding.${e}`) }))} onChange={(lineEnding) => patch({ lineEnding })} aria-label={t("tcp.lineEnding")} title={t("tcp.lineEnding")} />}
        <span className="grow" />
        <Button variant="primary" icon="paper-plane" disabled={!open} title={open ? "Ctrl+Enter" : t("ws.needConnection")} onClick={send}>{t("ws.send")}</Button>
      </div>
      <textarea className="mono ws-compose" rows={8} spellCheck={false} placeholder={t("ws.messagePlaceholder")} aria-label={t("ws.message")} value={d.message ?? ""}
        onChange={(e) => patch({ message: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); send(); } }} />
    </div>
  );
}

export function TcpSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  return (
    <div className="stack">
      <label className="row"><Checkbox checked={!!d.tlsInsecure} onChange={(tlsInsecure) => patch({ tlsInsecure })} label={t("tcp.tlsInsecure")} /> <span>{t("tcp.tlsInsecure")}</span></label>
      <span className="field-h">{t("tcp.tlsInsecureHint")}</span>
      <Field label={t("tcp.servername")} hint={t("tcp.servernameHint")}>
        <input value={d.servername ?? ""} placeholder="api.example.com" onChange={(e) => patch({ servername: e.target.value })} />
      </Field>
    </div>
  );
}
