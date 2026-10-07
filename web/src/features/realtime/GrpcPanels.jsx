import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../store.js";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox, Field } from "../../components/ui/Switch.jsx";
import { useT } from "../../i18n/index.js";

const kindOf = (m) => (m.clientStreaming ? (m.serverStreaming ? "bidi" : "client") : m.serverStreaming ? "server" : "unary");

/** Keeps the services and methods of the tab's .proto up to date (parsed on the server, shortly after typing stops). */
function useSchema(tab) {
  const proto = tab.req.protocol_data?.proto ?? "";
  const known = tab.grpc?.forProto;
  useEffect(() => {
    if (known === proto) return;
    const id = setTimeout(() => useStore.getState().describeProto(tab.key), known === undefined ? 0 : 400);
    return () => clearTimeout(id);
  }, [proto, known, tab.key]);
  return tab.grpc;
}

/** The "Message" tab: service and method, the request message, and the buttons for streaming calls. */
export function GrpcMessage({ tab }) {
  const t = useT();
  const { setReq, rtAct } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const schema = useSchema(tab);
  const services = schema?.services ?? [];
  const service = services.find((s) => s.name === d.service);
  const method = service?.methods.find((m) => m.name === d.method);
  const open = tab.rt?.status === "open";
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  // a freshly pasted .proto: pick its first method so there is something to invoke
  useEffect(() => {
    if (!d.service && !d.method && services[0]?.methods[0]) patch({ service: services[0].name, method: services[0].methods[0].name, message: JSON.stringify(services[0].methods[0].example, null, 2) });
  }, [services]);
  const chooseService = (name) => { const s = services.find((x) => x.name === name); patch({ service: name, method: s?.methods[0]?.name ?? "", message: s?.methods[0] ? JSON.stringify(s.methods[0].example, null, 2) : d.message }); };
  const chooseMethod = (name) => { const m = service?.methods.find((x) => x.name === name); patch({ method: name, ...(m && { message: JSON.stringify(m.example, null, 2) }) }); };
  const streamsIn = method?.clientStreaming;
  const sendNext = () => open && rtAct(tab.key, "send", { data: d.message ?? "{}" });
  if (!d.proto?.trim()) return <div className="muted pad">{t("grpc.needProto")}</div>;
  return (
    <div className="stack">
      {schema?.error && <div className="note err" role="alert">{schema.error}</div>}
      <div className="row wrap">
        <Select className="grow" value={d.service ?? ""} placeholder={t("grpc.service")} aria-label={t("grpc.service")} options={services.map((s) => ({ value: s.name, label: s.name }))} onChange={chooseService} />
        <Select className="grow" value={d.method ?? ""} placeholder={t("grpc.method")} aria-label={t("grpc.method")} disabled={!service} options={(service?.methods ?? []).map((m) => ({ value: m.name, label: m.name, description: t(`grpc.kind.${kindOf(m)}`) }))}
          renderValue={(o) => <>{o.label} <em className="kind">{t(`grpc.kind.${kindOf(service.methods.find((m) => m.name === o.value))}`)}</em></>}
          renderOption={(o) => <span className="proto-opt">{o.label}<em>{o.description}</em></span>} onChange={chooseMethod} />
      </div>
      {method && <div className="muted">{method.input} → {method.output}</div>}
      <textarea className="mono ws-compose" rows={10} spellCheck={false} placeholder={t("grpc.messagePlaceholder")} aria-label={t("grpc.message")} value={d.message ?? ""}
        onChange={(e) => patch({ message: e.target.value })} onKeyDown={(e) => { if (streamsIn && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); sendNext(); } }} />
      <div className="row wrap">
        <Button icon="wand-magic-sparkles" disabled={!method} onClick={() => patch({ message: JSON.stringify(method.example, null, 2) })}>{t("grpc.example")}</Button>
        <span className="grow" />
        {streamsIn && (
          <>
            <Button variant="primary" icon="paper-plane" disabled={!open} title={open ? "Ctrl+Enter" : t("grpc.needCall")} onClick={sendNext}>{t("grpc.send")}</Button>
            <Button disabled={!open} onClick={() => rtAct(tab.key, "end")}>{t("grpc.end")}</Button>
          </>
        )}
      </div>
    </div>
  );
}

export function GrpcProto({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const schema = useSchema(tab);
  const count = useMemo(() => (schema?.services ?? []).reduce((n, s) => n + s.methods.length, 0), [schema]);
  return (
    <div className="stack fill">
      <textarea className="mono ws-compose proto-src" spellCheck={false} placeholder={t("grpc.protoPlaceholder")} aria-label={t("grpc.proto")} value={d.proto ?? ""}
        onChange={(e) => setReq(tab.key, { protocol_data: { ...d, proto: e.target.value } })} />
      {schema?.error ? <div className="note err" role="alert">{schema.error}</div> : d.proto?.trim() && schema ? <div className="muted">{t("grpc.found", { services: schema.services.length, methods: count })}</div> : null}
      <span className="field-h">{t("grpc.protoHint")}</span>
    </div>
  );
}

export function GrpcSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const [deadline, setDeadline] = useState(String(d.deadlineMs ?? 0));
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  return (
    <div className="stack">
      <Field label={t("grpc.deadline")} hint={t("grpc.deadlineHint")}>
        <input inputMode="numeric" className="short" value={deadline} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 7); setDeadline(v); patch({ deadlineMs: Number(v) || 0 }); }} />
      </Field>
      <label className="row"><Checkbox checked={!!d.tlsInsecure} onChange={(tlsInsecure) => patch({ tlsInsecure })} label={t("grpc.tlsInsecure")} /> <span>{t("grpc.tlsInsecure")}</span></label>
      <span className="field-h">{t("grpc.tlsInsecureHint")}</span>
    </div>
  );
}
