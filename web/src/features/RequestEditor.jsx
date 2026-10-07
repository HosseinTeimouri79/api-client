import { useMemo, useRef } from "react";
import { useStore, can } from "../store.js";
import { METHODS, HEADER_NAMES, HEADER_VALUES } from "../lib/http.js";
import { VarsContext, useKnownVars } from "../lib/vars.jsx";
import { Select } from "../components/ui/Select.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { VarInput } from "../components/editor/VarInput.jsx";
import { KeyValueEditor } from "../components/editor/KeyValueEditor.jsx";
import { BodyEditor } from "../components/editor/BodyEditor.jsx";
import { AuthEditor } from "../components/editor/AuthEditor.jsx";
import { ScriptEditor } from "../components/editor/ScriptEditor.jsx";
import { CodeSnippetModal } from "./CodeSnippet.jsx";
import { WebSocketMessage, WebSocketSettings } from "./realtime/WebSocketPanels.jsx";
import { GrpcMessage, GrpcProto, GrpcSettings } from "./realtime/GrpcPanels.jsx";
import { PROTOCOLS, PROTOCOL_DEFAULTS, protocolOf } from "../lib/protocols.js";
import { modals } from "../components/ui/modals.js";
import { t as tr, useT } from "../i18n/index.js";

const METHOD_OPTS = METHODS.map((m) => ({ value: m, label: m }));
const PROTOCOL_OPTS = PROTOCOLS.map((p) => ({ value: p.id, label: p.label, tag: p.tag, disabled: !p.implemented }));
const HEADER_SUGG = Object.entries(HEADER_NAMES).map(([value, key]) => ({ value, label: value, get description() { return tr(key); } }));

export function RequestEditor({ tab }) {
  const t = useT();
  const { ws } = useStore();
  const { setReq, setSub, send, save } = useStore.getState();
  const vars = useKnownVars(tab);
  const c = can(ws);
  const r = tab.req;
  // View-only members may change anything to try a request out (it runs from this tab), but nothing can be saved.
  const ro = false, noSave = !c.write;
  const set = (patch) => setReq(tab.key, patch);
  const urlRef = useRef(null);

  // "?a=1&b=2" typed into the URL moves into the Params table
  const extractQuery = () => {
    const i = r.url.indexOf("?");
    if (i < 0 || r.url.includes("{{", i)) return;
    const extra = [...new URLSearchParams(r.url.slice(i + 1))].map(([key, value]) => ({ key, value, enabled: true }));
    set({ url: r.url.slice(0, i), params: [...r.params.filter((p) => p.key || p.value), ...extra] });
  };
  const inh = tab.inh ?? [];
  const inhCount = (k) => inh.filter((x) => x[k === "pre" ? "pre_script" : "post_script"]?.trim()).length;
  const filled = (l) => l.filter((x) => x.key).length;
  const proto = protocolOf(r.protocol);
  const rt = tab.rt?.status;
  const connected = rt === "open" || rt === "connecting";
  const http = [
    { id: "params", label: t("req.params"), badge: filled(r.params) || false },
    { id: "headers", label: t("req.headers"), badge: filled(r.headers) || false },
    { id: "body", label: t("req.body"), badge: r.body?.mode && r.body.mode !== "none" ? "●" : false },
    { id: "auth", label: t("req.auth"), badge: r.auth?.type && !["inherit", "none"].includes(r.auth.type) ? "●" : false },
    { id: "pre", label: t("req.pre"), badge: r.pre_script?.trim() || inhCount("pre") ? (inhCount("pre") ? `${inhCount("pre")}↑${r.pre_script?.trim() ? "+1" : ""}` : "●") : false, title: inhCount("pre") ? t("req.inheritedFirst", { n: inhCount("pre") }) : undefined },
    { id: "post", label: t("req.post"), badge: r.post_script?.trim() || inhCount("post") ? (inhCount("post") ? `${inhCount("post")}↑${r.post_script?.trim() ? "+1" : ""}` : "●") : false, title: inhCount("post") ? t("req.inheritedAfter", { n: inhCount("post") }) : undefined },
    { id: "docs", label: t("req.description"), badge: r.description?.trim() ? "●" : false },
  ];
  const docs = http.at(-1);
  const byProtocol = {
    websocket: [{ id: "message", label: t("ws.message"), badge: r.protocol_data?.message?.trim() ? "●" : false }, http[0], http[1], http[3], { id: "settings", label: t("ws.settings"), badge: r.protocol_data?.subprotocols?.trim() ? "●" : false }, docs],
    grpc: [{ id: "message", label: t("grpc.message"), badge: r.protocol_data?.method ? "●" : false }, { id: "proto", label: t("grpc.proto"), badge: r.protocol_data?.proto?.trim() ? "●" : false }, { ...http[1], label: t("grpc.metadata") }, http[3], { id: "settings", label: t("ws.settings"), badge: r.protocol_data?.tlsInsecure || r.protocol_data?.deadlineMs ? "●" : false }, docs],
  };
  const tabs = byProtocol[r.protocol] ?? http;
  const sub = tabs.some((x) => x.id === tab.sub) ? tab.sub : tabs[0].id;
  const switchProtocol = (id) => { set({ protocol: id, protocol_data: { ...PROTOCOL_DEFAULTS[id] }, ...(id === "http" ? {} : { method: "GET" }) }); setSub(tab.key, protocolOf(id).firstTab ?? "params"); };
  const editInherited = c.write ? (id) => useStore.getState().openCollection(id, tab.sub) : undefined;

  return (
    <VarsContext.Provider value={vars}>
      <div className="editor">
        {noSave && <div className="note viewer-note" role="note"><Icon name="eye" /> {t("viewer.note")}</div>}
        <div className="req-head">
          <input className="req-name" value={r.name} disabled={noSave} aria-label={t("req.nameLabel")} onChange={(e) => set({ name: e.target.value })} />
          {!proto.live && <Button icon="code" title={t("snippet.title")} onClick={() => modals.open((close) => <CodeSnippetModal close={close} tab={tab} />)}>{t("snippet.open")}</Button>}
          <Button icon="floppy-disk" disabled={noSave} title={noSave ? t("viewer.noSave") : "Ctrl+S"} onClick={save}>{t("common.save")}</Button>
        </div>
        <div className="urlbar">
          <Select className="protocol-select" value={r.protocol ?? "http"} options={PROTOCOL_OPTS} disabled={connected} title={connected ? t("proto.locked") : undefined} onChange={switchProtocol} aria-label={t("proto.label")}
            renderValue={(o) => <span className="proto-t">{o.label}</span>} renderOption={(o) => <span className="proto-opt">{o.label}{o.disabled && <em>{t("proto.soon")}</em>}</span>} />
          {!proto.live && <Select className="method-select" value={r.method} options={METHOD_OPTS} onChange={(method) => set({ method })} aria-label={t("req.method")} renderValue={(o) => <span className={`m-t m-${o.value}`}>{o.label}</span>} renderOption={(o) => <span className={`m-t m-${o.value}`}>{o.label}</span>} />}
          <VarInput className="url-input" value={r.url} placeholder={proto.live ? t(proto.urlKey) : t("req.urlPlaceholder")} aria-label={t("req.url")} inputRef={urlRef}
            onChange={(url) => set({ url })} onBlur={extractQuery} onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { extractQuery(); send(); } }} />
          {proto.live ? (
            <Button variant={connected ? "danger" : "primary"} icon={connected ? "plug-circle-xmark" : "plug"} id="sendBtn" loading={rt === "connecting"} onClick={() => send()} title="Ctrl+Enter">{t(proto.actionKeys[connected ? 1 : 0])}</Button>
          ) : (
            <Button variant="primary" icon="paper-plane" id="sendBtn" loading={tab.running} onClick={() => send()} title="Ctrl+Enter">{t("req.send")}</Button>
          )}
        </div>
        <Tabs items={tabs} value={sub} onChange={(s) => setSub(tab.key, s)} />
        <div className="editor-body">
          {sub === "message" && (r.protocol === "grpc" ? <GrpcMessage tab={tab} /> : <WebSocketMessage tab={tab} />)}
          {sub === "proto" && <GrpcProto tab={tab} />}
          {sub === "settings" && (r.protocol === "grpc" ? <GrpcSettings tab={tab} /> : <WebSocketSettings tab={tab} />)}
          {sub === "params" && <KeyValueEditor rows={r.params} readOnly={ro} onChange={(params) => set({ params })} keyPlaceholder={t("req.parameter")} />}
          {sub === "headers" && <KeyValueEditor rows={r.headers} readOnly={ro} onChange={(headers) => set({ headers })} keySuggestions={proto.live ? undefined : HEADER_SUGG} valueSuggestions={proto.live ? undefined : (k) => HEADER_VALUES[k.toLowerCase()]} keyPlaceholder={r.protocol === "grpc" ? t("grpc.metadataKey") : t("req.header")} />}
          {sub === "body" && <BodyEditor body={r.body} readOnly={ro} onChange={(body) => set({ body })} />}
          {sub === "auth" && <AuthEditor auth={r.auth} readOnly={ro} onChange={(auth) => set({ auth })} />}
          {sub === "pre" && <ScriptEditor kind="pre" value={r.pre_script} readOnly={ro} inherited={inh} onEditInherited={editInherited} onChange={(pre_script) => set({ pre_script })} />}
          {sub === "post" && <ScriptEditor kind="post" value={r.post_script} readOnly={ro} inherited={inh} onEditInherited={editInherited} onChange={(post_script) => set({ post_script })} />}
          {sub === "docs" && <textarea className="docs" rows={10} disabled={noSave} placeholder={t("req.descPlaceholder")} value={r.description} onChange={(e) => set({ description: e.target.value })} />}
        </div>
      </div>
    </VarsContext.Provider>
  );
}
