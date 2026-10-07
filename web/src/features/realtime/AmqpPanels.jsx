import { useMemo, useState } from "react";
import { useStore } from "../../store.js";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox, Field } from "../../components/ui/Switch.jsx";
import { pendingDeliveries } from "../../lib/amqp.js";
import { useT } from "../../i18n/index.js";

const FORMATS = ["text", "base64", "hex"];
const TYPES = ["direct", "fanout", "topic", "headers"];

const Check = ({ checked, onChange, label }) => (
  <label className="row"><Checkbox checked={checked} onChange={onChange} label={label} /> <span>{label}</span></label>
);

/** The "Publish" tab: exchange, routing key, payload and message properties. */
export function AmqpPublish({ tab }) {
  const t = useT();
  const { setReq, rtAct } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const open = tab.rt?.status === "open";
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const publish = () => open && rtAct(tab.key, "publish", {
    exchange: d.exchange ?? "", routingKey: d.routingKey ?? "", payload: d.payload ?? "", format: d.payloadFormat ?? "text", contentType: d.contentType ?? "", deliveryMode: d.deliveryMode ?? 1,
    correlationId: d.correlationId ?? "", replyTo: d.replyTo ?? "", messageId: d.messageId ?? "", expiration: d.expiration ?? "", type: d.type ?? "", headers: d.headers ?? "", mandatory: !!d.mandatory,
  });
  const text = (key, label, extra = {}) => <Field label={label} className="grow" {...extra}><input value={d[key] ?? ""} onChange={(e) => patch({ [key]: e.target.value })} /></Field>;
  return (
    <div className="stack">
      <div className="row wrap">
        {text("exchange", t("amqp.exchange"), { hint: t("amqp.exchangeHint") })}
        {text("routingKey", t("amqp.routingKey"))}
      </div>
      <div className="row wrap">
        <Select value={d.payloadFormat ?? "text"} options={FORMATS.map((f) => ({ value: f, label: t(`ws.format.${f}`) }))} onChange={(payloadFormat) => patch({ payloadFormat })} aria-label={t("ws.format")} />
        <span className="grow" />
        <Button variant="primary" icon="paper-plane" disabled={!open} title={open ? "Ctrl+Enter" : t("ws.needConnection")} onClick={publish}>{t("mqtt.publishBtn")}</Button>
      </div>
      <textarea className="mono ws-compose" rows={7} spellCheck={false} placeholder={t("ws.messagePlaceholder")} aria-label={t("mqtt.payload")} value={d.payload ?? ""}
        onChange={(e) => patch({ payload: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); publish(); } }} />
      <h4>{t("amqp.properties")}</h4>
      <div className="row wrap">{text("contentType", t("amqp.contentType"))}{text("type", t("amqp.type"))}</div>
      <div className="row wrap">{text("correlationId", t("amqp.correlationId"))}{text("replyTo", t("amqp.replyTo"))}</div>
      <div className="row wrap">{text("messageId", t("amqp.messageId"))}{text("expiration", t("amqp.expiration"))}</div>
      <Field label={t("amqp.headers")}><textarea className="mono" rows={3} spellCheck={false} placeholder='{ "tenant": "acme" }' value={d.headers ?? ""} onChange={(e) => patch({ headers: e.target.value })} /></Field>
      <div className="row wrap">
        <Check checked={d.deliveryMode === 2} onChange={(v) => patch({ deliveryMode: v ? 2 : 1 })} label={t("amqp.persistent")} />
        <Check checked={!!d.mandatory} onChange={(mandatory) => patch({ mandatory })} label={t("amqp.mandatory")} />
      </div>
      <span className="field-h">{t("amqp.mandatoryHint")}</span>
    </div>
  );
}

/** The "Consume" tab: the queue (declared and bound if wanted), prefetch, auto-ack, and the active consumers. */
export function AmqpConsume({ tab }) {
  const t = useT();
  const { setReq, rtAct } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const open = tab.rt?.status === "open";
  const consumers = tab.rt?.subs ?? [];
  const pending = useMemo(() => pendingDeliveries(tab.rt?.events ?? []), [tab.rt?.events]);
  const [prefetch, setPrefetch] = useState(String(d.prefetch ?? 10));
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const consume = () => open && rtAct(tab.key, "consume", {
    queue: d.queue ?? "", declare: d.declareQueue !== false ? { durable: !!d.durable, exclusive: !!d.exclusive, autoDelete: !!d.autoDelete } : null,
    bind: d.bindExchange?.trim() ? { exchange: d.bindExchange.trim(), routingKey: d.bindKey ?? "", exchangeType: d.exchangeType ?? "" } : null, prefetch: d.prefetch ?? 0, noAck: !!d.noAck,
  });
  const ackAll = () => rtAct(tab.key, "ack", { deliveryTag: Math.max(...pending.keys()), multiple: true });
  const declare = d.declareQueue !== false;
  return (
    <div className="stack">
      <Field label={t("amqp.queue")} hint={t("amqp.queueHint")}>
        <input value={d.queue ?? ""} placeholder="orders" onChange={(e) => patch({ queue: e.target.value })} onKeyDown={(e) => e.key === "Enter" && consume()} />
      </Field>
      <Check checked={declare} onChange={(declareQueue) => patch({ declareQueue })} label={t("amqp.declare")} />
      {declare && (
        <div className="row wrap">
          <Check checked={!!d.durable} onChange={(durable) => patch({ durable })} label={t("amqp.durable")} />
          <Check checked={!!d.exclusive} onChange={(exclusive) => patch({ exclusive })} label={t("amqp.exclusive")} />
          <Check checked={!!d.autoDelete} onChange={(autoDelete) => patch({ autoDelete })} label={t("amqp.autoDelete")} />
        </div>
      )}
      <h4>{t("amqp.bind")}</h4>
      <div className="row wrap">
        <Field label={t("amqp.exchange")} className="grow"><input value={d.bindExchange ?? ""} onChange={(e) => patch({ bindExchange: e.target.value })} /></Field>
        <Field label={t("amqp.bindKey")} className="grow"><input value={d.bindKey ?? ""} onChange={(e) => patch({ bindKey: e.target.value })} /></Field>
        <Field label={t("amqp.exchangeType")}>
          <Select value={d.exchangeType ?? ""} options={[{ value: "", label: t("amqp.exchangeType.none") }, ...TYPES.map((x) => ({ value: x, label: x }))]} onChange={(exchangeType) => patch({ exchangeType })} aria-label={t("amqp.exchangeType")} />
        </Field>
      </div>
      <div className="row wrap">
        <Field label={t("amqp.prefetch")} hint={t("amqp.prefetchHint")}><input inputMode="numeric" className="short" value={prefetch} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 5); setPrefetch(v); patch({ prefetch: Number(v) || 0 }); }} /></Field>
        <Check checked={!!d.noAck} onChange={(noAck) => patch({ noAck })} label={t("amqp.noAck")} />
        <span className="grow" />
        <Button variant="primary" icon="inbox" disabled={!open} title={open ? undefined : t("ws.needConnection")} onClick={consume}>{t("amqp.consumeBtn")}</Button>
      </div>
      <h4>{t("amqp.activeConsumers")}</h4>
      {consumers.length ? (
        <table className="htable"><tbody>
          {consumers.map((c) => (
            <tr key={c.tag}><th className="mono">{c.queue}</th><td>{c.noAck ? t("amqp.noAck") : t("amqp.manualAck")}</td>
              <td><Button size="sm" disabled={!open} onClick={() => rtAct(tab.key, "cancel", { tag: c.tag })}>{t("amqp.cancel")}</Button></td></tr>
          ))}
        </tbody></table>
      ) : <div className="muted">{t("amqp.noConsumers")}</div>}
      {pending.size > 0 && (
        <div className="row"><span className="muted">{t("amqp.pendingCount", { n: pending.size })}</span><Button size="sm" disabled={!open} onClick={ackAll}>{t("amqp.ackAll")}</Button></div>
      )}
    </div>
  );
}

export function AmqpSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const [beat, setBeat] = useState(String(d.heartbeat ?? 30));
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  return (
    <div className="stack">
      <div className="row wrap">
        <Field label={t("mqtt.username")} hint={t("amqp.credentialsHint")} className="grow"><input value={d.username ?? ""} autoComplete="off" onChange={(e) => patch({ username: e.target.value })} /></Field>
        <Field label={t("mqtt.password")} className="grow"><input type="password" value={d.password ?? ""} autoComplete="new-password" onChange={(e) => patch({ password: e.target.value })} /></Field>
      </div>
      <Field label={t("amqp.heartbeat")} hint={t("amqp.heartbeatHint")}>
        <input inputMode="numeric" className="short" value={beat} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 3); setBeat(v); patch({ heartbeat: Number(v) || 0 }); }} />
      </Field>
      <Check checked={!!d.tlsInsecure} onChange={(tlsInsecure) => patch({ tlsInsecure })} label={t("tcp.tlsInsecure")} />
      <span className="field-h">{t("amqp.tlsInsecureHint")}</span>
    </div>
  );
}
