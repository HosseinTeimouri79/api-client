import { useState } from "react";
import { useStore } from "../../store.js";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox, Field } from "../../components/ui/Switch.jsx";
import { useT } from "../../i18n/index.js";

const FORMATS = ["text", "base64", "hex"];
const QOS = [0, 1, 2];
const VERSIONS = [{ value: 4, label: "3.1.1" }, { value: 5, label: "5.0" }, { value: 3, label: "3.1" }];
const num = (set, patch, key, max) => (e) => { const v = e.target.value.replace(/\D/g, "").slice(0, max); set(v); patch({ [key]: Number(v) || 0 }); };

function QosSelect({ value, onChange, label }) {
  const t = useT();
  return <Select value={value ?? 0} options={QOS.map((q) => ({ value: q, label: t(`mqtt.qos.${q}`) }))} onChange={onChange} aria-label={label} title={label} />;
}

/** The "Publish" tab: topic, payload (text, base64 or hex), QoS and retain. */
export function MqttPublish({ tab }) {
  const t = useT();
  const { setReq, rtAct } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const open = tab.rt?.status === "open";
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const publish = () => open && rtAct(tab.key, "publish", { topic: d.topic ?? "", payload: d.payload ?? "", format: d.payloadFormat ?? "text", qos: d.qos ?? 0, retain: !!d.retain });
  return (
    <div className="stack">
      <Field label={t("mqtt.topic")}>
        <input value={d.topic ?? ""} placeholder="devices/{{deviceId}}/state" onChange={(e) => patch({ topic: e.target.value })} onKeyDown={(e) => e.key === "Enter" && publish()} />
      </Field>
      <div className="row wrap">
        <Select value={d.payloadFormat ?? "text"} options={FORMATS.map((f) => ({ value: f, label: t(`ws.format.${f}`) }))} onChange={(payloadFormat) => patch({ payloadFormat })} aria-label={t("ws.format")} />
        <QosSelect value={d.qos} onChange={(qos) => patch({ qos })} label={t("mqtt.qos")} />
        <label className="row"><Checkbox checked={!!d.retain} onChange={(retain) => patch({ retain })} label={t("mqtt.retain")} /> <span>{t("mqtt.retain")}</span></label>
        <span className="grow" />
        <Button variant="primary" icon="paper-plane" disabled={!open} title={open ? "Ctrl+Enter" : t("ws.needConnection")} onClick={publish}>{t("mqtt.publishBtn")}</Button>
      </div>
      <textarea className="mono ws-compose" rows={8} spellCheck={false} placeholder={t("ws.messagePlaceholder")} aria-label={t("mqtt.payload")} value={d.payload ?? ""}
        onChange={(e) => patch({ payload: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); publish(); } }} />
    </div>
  );
}

/** The "Subscribe" tab: add a topic filter, see and remove the active subscriptions. */
export function MqttSubscribe({ tab }) {
  const t = useT();
  const { setReq, rtAct } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const open = tab.rt?.status === "open";
  const subs = tab.rt?.subs ?? [];
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const add = () => open && d.subTopic?.trim() && rtAct(tab.key, "subscribe", { topic: d.subTopic.trim(), qos: d.subQos ?? 0 });
  return (
    <div className="stack">
      <Field label={t("mqtt.filter")} hint={t("mqtt.filterHint")}>
        <div className="row">
          <input className="grow" value={d.subTopic ?? ""} placeholder="sensors/+/temperature" onChange={(e) => patch({ subTopic: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
          <QosSelect value={d.subQos} onChange={(subQos) => patch({ subQos })} label={t("mqtt.qos")} />
          <Button variant="primary" icon="bell" disabled={!open || !d.subTopic?.trim()} title={open ? undefined : t("ws.needConnection")} onClick={add}>{t("mqtt.subscribeBtn")}</Button>
        </div>
      </Field>
      <h4>{t("mqtt.activeSubs")}</h4>
      {subs.length ? (
        <table className="htable"><tbody>
          {subs.map((s) => (
            <tr key={s.topic}><th className="mono">{s.topic}</th><td>{t(`mqtt.qos.${s.qos}`)}</td>
              <td><Button size="sm" disabled={!open} onClick={() => rtAct(tab.key, "unsubscribe", { topic: s.topic })}>{t("mqtt.unsubscribe")}</Button></td></tr>
          ))}
        </tbody></table>
      ) : <div className="muted">{t("mqtt.noSubs")}</div>}
    </div>
  );
}

/** Connection settings: client id, credentials, version, keep-alive, TLS and the last will. */
export function MqttSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const [keep, setKeep] = useState(String(d.keepalive ?? 60));
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  return (
    <div className="stack">
      <Field label={t("mqtt.clientId")} hint={t("mqtt.clientIdHint")}><input value={d.clientId ?? ""} onChange={(e) => patch({ clientId: e.target.value })} /></Field>
      <div className="row wrap">
        <Field label={t("mqtt.username")} className="grow"><input value={d.username ?? ""} autoComplete="off" onChange={(e) => patch({ username: e.target.value })} /></Field>
        <Field label={t("mqtt.password")} className="grow"><input type="password" value={d.password ?? ""} autoComplete="new-password" onChange={(e) => patch({ password: e.target.value })} /></Field>
      </div>
      <div className="row wrap">
        <Field label={t("mqtt.version")}><Select value={d.protocolVersion ?? 4} options={VERSIONS} onChange={(protocolVersion) => patch({ protocolVersion })} aria-label={t("mqtt.version")} /></Field>
        <Field label={t("mqtt.keepalive")} hint={t("mqtt.keepaliveHint")}><input inputMode="numeric" className="short" value={keep} onChange={num(setKeep, patch, "keepalive", 4)} /></Field>
      </div>
      <label className="row"><Checkbox checked={d.clean !== false} onChange={(clean) => patch({ clean })} label={t("mqtt.clean")} /> <span>{t("mqtt.clean")}</span></label>
      <span className="field-h">{t("mqtt.cleanHint")}</span>
      <label className="row"><Checkbox checked={!!d.tlsInsecure} onChange={(tlsInsecure) => patch({ tlsInsecure })} label={t("tcp.tlsInsecure")} /> <span>{t("tcp.tlsInsecure")}</span></label>
      <span className="field-h">{t("mqtt.tlsInsecureHint")}</span>
      <h4>{t("mqtt.will")}</h4>
      <span className="field-h">{t("mqtt.willHint")}</span>
      <Field label={t("mqtt.topic")}><input value={d.willTopic ?? ""} onChange={(e) => patch({ willTopic: e.target.value })} /></Field>
      <Field label={t("mqtt.payload")}><input value={d.willPayload ?? ""} onChange={(e) => patch({ willPayload: e.target.value })} /></Field>
      <div className="row wrap">
        <QosSelect value={d.willQos} onChange={(willQos) => patch({ willQos })} label={t("mqtt.qos")} />
        <label className="row"><Checkbox checked={!!d.willRetain} onChange={(willRetain) => patch({ willRetain })} label={t("mqtt.retain")} /> <span>{t("mqtt.retain")}</span></label>
      </div>
    </div>
  );
}
