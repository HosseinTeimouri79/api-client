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

const METHOD_OPTS = METHODS.map((m) => ({ value: m, label: m }));
const HEADER_SUGG = Object.entries(HEADER_NAMES).map(([value, description]) => ({ value, label: value, description }));

export function RequestEditor({ tab }) {
  const { ws } = useStore();
  const { setReq, setSub, send, save } = useStore.getState();
  const vars = useKnownVars(tab);
  const c = can(ws);
  const r = tab.req, ro = !c.write && !!tab.id;
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
  const tabs = [
    { id: "params", label: "Params", badge: filled(r.params) || false },
    { id: "headers", label: "Headers", badge: filled(r.headers) || false },
    { id: "body", label: "Body", badge: r.body?.mode && r.body.mode !== "none" ? "●" : false },
    { id: "auth", label: "Auth", badge: r.auth?.type && !["inherit", "none"].includes(r.auth.type) ? "●" : false },
    { id: "pre", label: "Pre-request", badge: r.pre_script?.trim() || inhCount("pre") ? (inhCount("pre") ? `${inhCount("pre")}↑${r.pre_script?.trim() ? "+1" : ""}` : "●") : false, title: inhCount("pre") ? `${inhCount("pre")} inherited collection script(s) run first` : undefined },
    { id: "post", label: "Post-request", badge: r.post_script?.trim() || inhCount("post") ? (inhCount("post") ? `${inhCount("post")}↑${r.post_script?.trim() ? "+1" : ""}` : "●") : false, title: inhCount("post") ? `${inhCount("post")} inherited collection script(s) run after` : undefined },
    { id: "docs", label: "Description" },
  ];
  const editInherited = c.write ? (id) => useStore.getState().openCollection(id, tab.sub) : undefined;

  return (
    <VarsContext.Provider value={vars}>
      <div className="editor">
        <div className="req-head">
          <input className="req-name" value={r.name} disabled={ro} aria-label="Request name" onChange={(e) => set({ name: e.target.value })} />
          <Button icon="floppy-disk" disabled={ro} title="Ctrl+S" onClick={save}>Save</Button>
        </div>
        <div className="urlbar">
          <Select className="method-select" value={r.method} options={METHOD_OPTS} onChange={(method) => set({ method })} aria-label="Method" renderValue={(o) => <span className={`m-t m-${o.value}`}>{o.label}</span>} renderOption={(o) => <span className={`m-t m-${o.value}`}>{o.label}</span>} />
          <VarInput className="url-input" value={r.url} placeholder="https://api.example.com/users   or   {{baseUrl}}/users" aria-label="URL" inputRef={urlRef}
            onChange={(url) => set({ url })} onBlur={extractQuery} onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { extractQuery(); send(); } }} />
          <Button variant="primary" icon="paper-plane" id="sendBtn" loading={tab.running} onClick={() => send()} title="Ctrl+Enter">Send</Button>
        </div>
        <Tabs items={tabs} value={tab.sub} onChange={(s) => setSub(tab.key, s)} />
        <div className="editor-body">
          {tab.sub === "params" && <KeyValueEditor rows={r.params} readOnly={ro} onChange={(params) => set({ params })} keyPlaceholder="Parameter" />}
          {tab.sub === "headers" && <KeyValueEditor rows={r.headers} readOnly={ro} onChange={(headers) => set({ headers })} keySuggestions={HEADER_SUGG} valueSuggestions={(k) => HEADER_VALUES[k.toLowerCase()]} keyPlaceholder="Header" />}
          {tab.sub === "body" && <BodyEditor body={r.body} readOnly={ro} onChange={(body) => set({ body })} />}
          {tab.sub === "auth" && <AuthEditor auth={r.auth} readOnly={ro} onChange={(auth) => set({ auth })} />}
          {tab.sub === "pre" && <ScriptEditor kind="pre" value={r.pre_script} readOnly={ro} inherited={inh} onEditInherited={editInherited} onChange={(pre_script) => set({ pre_script })} />}
          {tab.sub === "post" && <ScriptEditor kind="post" value={r.post_script} readOnly={ro} inherited={inh} onEditInherited={editInherited} onChange={(post_script) => set({ post_script })} />}
          {tab.sub === "docs" && <textarea className="docs" rows={10} disabled={ro} placeholder="Describe what this request does…" value={r.description} onChange={(e) => set({ description: e.target.value })} />}
        </div>
      </div>
    </VarsContext.Provider>
  );
}
