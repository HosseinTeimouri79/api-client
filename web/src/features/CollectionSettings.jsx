import { useStore, can } from "../store.js";
import { Button } from "../components/ui/Button.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { KeyValueEditor } from "../components/editor/KeyValueEditor.jsx";
import { AuthEditor } from "../components/editor/AuthEditor.jsx";
import { ScriptEditor } from "../components/editor/ScriptEditor.jsx";
import { useT } from "../i18n/index.js";

/** Full-size settings view for a collection tab (variables, auth and scripts inherited by everything inside it). */
export function CollectionSettings({ tab }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const { setDraft, setSub, save } = useStore.getState();
  const d = tab.draft, ro = !can(ws).write;
  const set = (patch) => setDraft(tab.key, patch);
  const filled = (l) => l.filter((x) => x.key).length;
  const items = [
    { id: "vars", label: t("col.variables"), badge: filled(d.variables) || false },
    { id: "auth", label: t("col.auth"), badge: d.auth?.type && d.auth.type !== "none" ? "●" : false },
    { id: "pre", label: t("req.pre"), badge: d.pre_script?.trim() ? "●" : false },
    { id: "post", label: t("req.post"), badge: d.post_script?.trim() ? "●" : false },
    { id: "docs", label: t("req.description"), badge: d.description?.trim() ? "●" : false },
  ];
  return (
    <div className="editor col-settings">
      <div className="req-head">
        <Icon name="folder-open" className="folder" />
        <h2 className="col-title">{tab.name}</h2>
        <Button variant="primary" icon="floppy-disk" disabled={ro || !tab.dirty} title="Ctrl+S" onClick={save}>{t("common.save")}</Button>
      </div>
      <p className="muted col-hint">{t("col.hint")}</p>
      <Tabs items={items} value={tab.sub} onChange={(s) => setSub(tab.key, s)} />
      <div className="editor-body">
        {tab.sub === "docs" && <textarea className="docs" rows={10} disabled={ro} aria-label={t("col.descLabel")} placeholder={t("col.descPlaceholder")} value={d.description ?? ""} onChange={(e) => set({ description: e.target.value })} />}
        {tab.sub === "vars" && <KeyValueEditor rows={d.variables} readOnly={ro} onChange={(variables) => set({ variables })} keyPlaceholder={t("col.variable")} />}
        {tab.sub === "auth" && <AuthEditor auth={d.auth ?? { type: "none" }} allowInherit={false} readOnly={ro} onChange={(auth) => set({ auth })} />}
        {tab.sub === "pre" && <ScriptEditor kind="pre" value={d.pre_script} readOnly={ro} onChange={(pre_script) => set({ pre_script })} />}
        {tab.sub === "post" && <ScriptEditor kind="post" value={d.post_script} readOnly={ro} onChange={(post_script) => set({ post_script })} />}
      </div>
    </div>
  );
}
