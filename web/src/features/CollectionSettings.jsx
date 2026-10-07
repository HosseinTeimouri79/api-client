import { useStore, can } from "../store.js";
import { Button } from "../components/ui/Button.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Icon } from "../components/ui/Icon.jsx";
import { KeyValueEditor } from "../components/editor/KeyValueEditor.jsx";
import { AuthEditor } from "../components/editor/AuthEditor.jsx";
import { ScriptEditor } from "../components/editor/ScriptEditor.jsx";

/** Full-size settings view for a collection tab (variables, auth and scripts inherited by everything inside it). */
export function CollectionSettings({ tab }) {
  const ws = useStore((s) => s.ws);
  const { setDraft, setSub, save } = useStore.getState();
  const d = tab.draft, ro = !can(ws).write;
  const set = (patch) => setDraft(tab.key, patch);
  const filled = (l) => l.filter((x) => x.key).length;
  const items = [
    { id: "vars", label: "Variables", badge: filled(d.variables) || false },
    { id: "auth", label: "Authorization", badge: d.auth?.type && d.auth.type !== "none" ? "●" : false },
    { id: "pre", label: "Pre-request", badge: d.pre_script?.trim() ? "●" : false },
    { id: "post", label: "Post-request", badge: d.post_script?.trim() ? "●" : false },
    { id: "docs", label: "Description", badge: d.description?.trim() ? "●" : false },
  ];
  return (
    <div className="editor col-settings">
      <div className="req-head">
        <Icon name="folder-open" className="folder" />
        <h2 className="col-title">{tab.name}</h2>
        <Button variant="primary" icon="floppy-disk" disabled={ro || !tab.dirty} title="Ctrl+S" onClick={save}>Save</Button>
      </div>
      <p className="muted col-hint">Variables, auth and scripts here apply to every request in this collection and its sub-collections.</p>
      <Tabs items={items} value={tab.sub} onChange={(s) => setSub(tab.key, s)} />
      <div className="editor-body">
        {tab.sub === "docs" && <textarea className="docs" rows={10} disabled={ro} aria-label="Collection description" placeholder="Describe what this collection is for…" value={d.description ?? ""} onChange={(e) => set({ description: e.target.value })} />}
        {tab.sub === "vars" && <KeyValueEditor rows={d.variables} readOnly={ro} onChange={(variables) => set({ variables })} keyPlaceholder="Variable" />}
        {tab.sub === "auth" && <AuthEditor auth={d.auth ?? { type: "none" }} allowInherit={false} readOnly={ro} onChange={(auth) => set({ auth })} />}
        {tab.sub === "pre" && <ScriptEditor kind="pre" value={d.pre_script} readOnly={ro} onChange={(pre_script) => set({ pre_script })} />}
        {tab.sub === "post" && <ScriptEditor kind="post" value={d.post_script} readOnly={ro} onChange={(post_script) => set({ post_script })} />}
      </div>
    </div>
  );
}
