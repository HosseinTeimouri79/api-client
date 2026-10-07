import { useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useStore, can } from "../store.js";
import { downloadJson } from "../lib/utils.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Select } from "../components/ui/Select.jsx";
import { Tabs } from "../components/ui/Tabs.jsx";
import { Field } from "../components/ui/Switch.jsx";
import { Icon, Spinner } from "../components/ui/Icon.jsx";
import { toast } from "../components/ui/Toasts.jsx";

const LABELS = { "postman-collection": "Postman collection", "postman-environment": "Postman environment", "hoppscotch-collection": "Hoppscotch collection", "hoppscotch-environment": "Hoppscotch environment" };
export async function exportRemote(query) {
  const { W } = useStore.getState();
  const r = await api("GET", W("/export?" + new URLSearchParams(query)));
  downloadJson(r.filename, r.data);
  toast(r.warnings?.length ? `Exported ${r.filename} (${r.warnings.length} notes)` : `Exported ${r.filename}`, r.warnings?.length ? "info" : "ok");
  return r;
}
const flatten = (cols, parent = null, depth = 0) => cols.filter((c) => (c.parent_id ?? null) === parent).flatMap((c) => [{ ...c, depth }, ...flatten(cols, c.id, depth + 1)]);
const indent = (c) => "  ".repeat(c.depth) + (c.depth ? "↳ " : "") + c.name;

export function InteropModal({ close }) {
  const { ws, tree, envs } = useStore();
  const { W, reloadTree, refreshEnvs } = useStore.getState();
  const c = can(ws);
  const cols = useMemo(() => flatten(tree.collections), [tree.collections]);
  const [tab, setTab] = useState(c.write ? "import" : "export");
  const [files, setFiles] = useState([]);
  const [dest, setDest] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fmt, setFmt] = useState("postman");
  const [what, setWhat] = useState(cols.length ? `c:${cols[0].id}` : envs.length ? `e:${envs[0].id}` : "");
  const imported = useRef(false);

  const run = async () => {
    setBusy(true); setResults([]);
    for (const f of files) {
      let line;
      try {
        const r = await api("POST", W("/import"), { data: JSON.parse(await f.text()), parent_id: dest || null });
        imported.current = true;
        line = { ok: true, text: `${f.name} — ${LABELS[r.format] ?? r.format}: ${r.environments ? `${r.environments} environment(s)` : `${r.collections} collection(s), ${r.requests} request(s)`}`, warnings: r.warnings };
      } catch (e) { line = { ok: false, text: `${f.name} — ${e instanceof SyntaxError ? "not valid JSON" : e.message}` }; }
      setResults((l) => [...l, line]);
    }
    setBusy(false);
  };
  const finish = async () => { if (imported.current) { await reloadTree(); await refreshEnvs(); } close(); };
  const whatOptions = [
    ...(fmt === "hoppscotch" ? [{ value: "c:", label: "All top-level collections", group: "Collections" }] : []),
    ...cols.map((x) => ({ value: `c:${x.id}`, label: indent(x), group: "Collections" })),
    ...(fmt === "hoppscotch" && envs.length > 1 ? [{ value: "e:all", label: "All environments", group: "Environments" }] : []),
    ...envs.map((e) => ({ value: `e:${e.id}`, label: e.name, group: "Environments" })),
  ];
  const doExport = async () => {
    setBusy(true);
    try { const [kind, id] = what.split(":"); await exportRemote({ format: fmt, ...(kind === "c" ? { collection: id } : { environment: id }) }); }
    catch (e) { toast(e.message, "error"); }
    setBusy(false);
  };
  return (
    <Modal title="Import / Export" onClose={finish}>
      <Tabs variant="pill" value={tab} onChange={setTab} items={[...(c.write ? [{ id: "import", label: "Import" }] : []), { id: "export", label: "Export" }]} />
      {tab === "import" ? (
        <div className="stack">
          <label className="dropzone"><Icon name="cloud-arrow-up" /><span>{files.length ? files.map((f) => f.name).join(", ") : "Click to choose Postman or Hoppscotch .json files"}</span>
            <input type="file" accept=".json,application/json" multiple hidden onChange={(e) => { setFiles([...e.target.files]); setResults([]); }} /></label>
          <Field label="Destination (collections only)"><Select value={dest} onChange={setDest} options={[{ value: "", label: "Workspace root", icon: "house" }, ...cols.map((x) => ({ value: x.id, label: indent(x), icon: "folder" }))]} /></Field>
          <div className="row end"><Button variant="primary" icon="file-import" disabled={!files.length} loading={busy} onClick={run}>Import</Button></div>
          {results.map((r, i) => (
            <div key={i} className={`interop-result ${r.ok ? "ok" : "err"}`}><Icon name={r.ok ? "circle-check" : "circle-xmark"} /><span>{r.text}</span>
              {r.warnings?.length > 0 && <ul className="muted">{r.warnings.map((w, j) => <li key={j}>{w}</li>)}</ul>}</div>
          ))}
          <p className="muted">Format is detected automatically. Variables, auth, headers, bodies and scripts are converted; unsupported parts are reported as notes.</p>
        </div>
      ) : (
        <div className="stack">
          <Field label="Format"><Select value={fmt} onChange={(v) => { setFmt(v); setWhat(cols.length ? `c:${cols[0].id}` : envs.length ? `e:${envs[0].id}` : ""); }} options={[{ value: "postman", label: "Postman (v2.1)" }, { value: "hoppscotch", label: "Hoppscotch" }]} /></Field>
          <Field label="What to export"><Select value={what} onChange={setWhat} options={whatOptions} searchable placeholder="Nothing to export" /></Field>
          <div className="row end"><Button variant="primary" icon="file-export" disabled={!what && !whatOptions.length} loading={busy} onClick={doExport}>Download</Button></div>
          <p className="muted">Environment secrets are exported with their values. Hoppscotch has no collection-level variables/scripts; inherited auth is copied into each request.</p>
        </div>
      )}
    </Modal>
  );
}
