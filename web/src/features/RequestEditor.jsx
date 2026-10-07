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
import { modals } from "../components/ui/modals.js";
import { t as tr, useT } from "../i18n/index.js";

const METHOD_OPTS = METHODS.map((m) => ({ value: m, label: m }));
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
  const tabs = [
    { id: "params", label: t("req.params"), badge: filled(r.params) || false },
    { id: "headers", label: t("req.headers"), badge: filled(r.headers) || false },
    { id: "body", label: t("req.body"), badge: r.body?.mode && r.body.mode !== "none" ? "●" : false },
    { id: "auth", label: t("req.auth"), badge: r.auth?.type && !["inherit", "none"].includes(r.auth.type) ? "●" : false },
    { id: "pre", label: t("req.pre"), badge: r.pre_script?.trim() || inhCount("pre") ? (inhCount("pre") ? `${inhCount("pre")}↑${r.pre_script?.trim() ? "+1" : ""}` : "●") : false, title: inhCount("pre") ? t("req.inheritedFirst", { n: inhCount("pre") }) : undefined },
    { id: "post", label: t("req.post"), badge: r.post_script?.trim() || inhCount("post") ? (inhCount("post") ? `${inhCount("post")}↑${r.post_script?.trim() ? "+1" : ""}` : "●") : false, title: inhCount("post") ? t("req.inheritedAfter", { n: inhCount("post") }) : undefined },
    { id: "docs", label: t("req.description"), badge: r.description?.trim() ? "●" : false },
  ];
  const editInherited = c.write ? (id) => useStore.getState().openCollection(id, tab.sub) : undefined;

  return (
    <VarsContext.Provider value={vars}>
      <div className="editor">
        {noSave && <div className="note viewer-note" role="note"><Icon name="eye" /> {t("viewer.note")}</div>}
        <div className="req-head">
          <input className="req-name" value={r.name} disabled={noSave} aria-label={t("req.nameLabel")} onChange={(e) => set({ name: e.target.value })} />
          <Button icon="code" title={t("snippet.title")} onClick={() => modals.open((close) => <CodeSnippetModal close={close} tab={tab} />)}>{t("snippet.open")}</Button>
          <Button icon="floppy-disk" disabled={noSave} title={noSave ? t("viewer.noSave") : "Ctrl+S"} onClick={save}>{t("common.save")}</Button>
        </div>
        <div className="urlbar">
          <Select className="method-select" value={r.method} options={METHOD_OPTS} onChange={(method) => set({ method })} aria-label={t("req.method")} renderValue={(o) => <span className={`m-t m-${o.value}`}>{o.label}</span>} renderOption={(o) => <span className={`m-t m-${o.value}`}>{o.label}</span>} />
          <VarInput className="url-input" value={r.url} placeholder={t("req.urlPlaceholder")} aria-label={t("req.url")} inputRef={urlRef}
            onChange={(url) => set({ url })} onBlur={extractQuery} onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { extractQuery(); send(); } }} />
          <Button variant="primary" icon="paper-plane" id="sendBtn" loading={tab.running} onClick={() => send()} title="Ctrl+Enter">{t("req.send")}</Button>
        </div>
        <Tabs items={tabs} value={tab.sub} onChange={(s) => setSub(tab.key, s)} />
        <div className="editor-body">
          {tab.sub === "params" && <KeyValueEditor rows={r.params} readOnly={ro} onChange={(params) => set({ params })} keyPlaceholder={t("req.parameter")} />}
          {tab.sub === "headers" && <KeyValueEditor rows={r.headers} readOnly={ro} onChange={(headers) => set({ headers })} keySuggestions={HEADER_SUGG} valueSuggestions={(k) => HEADER_VALUES[k.toLowerCase()]} keyPlaceholder={t("req.header")} />}
          {tab.sub === "body" && <BodyEditor body={r.body} readOnly={ro} onChange={(body) => set({ body })} />}
          {tab.sub === "auth" && <AuthEditor auth={r.auth} readOnly={ro} onChange={(auth) => set({ auth })} />}
          {tab.sub === "pre" && <ScriptEditor kind="pre" value={r.pre_script} readOnly={ro} inherited={inh} onEditInherited={editInherited} onChange={(pre_script) => set({ pre_script })} />}
          {tab.sub === "post" && <ScriptEditor kind="post" value={r.post_script} readOnly={ro} inherited={inh} onEditInherited={editInherited} onChange={(post_script) => set({ post_script })} />}
          {tab.sub === "docs" && <textarea className="docs" rows={10} disabled={noSave} placeholder={t("req.descPlaceholder")} value={r.description} onChange={(e) => set({ description: e.target.value })} />}
        </div>
      </div>
    </VarsContext.Provider>
  );
}
