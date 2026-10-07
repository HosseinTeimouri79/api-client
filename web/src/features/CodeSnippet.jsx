import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { useT } from "../i18n/index.js";
import { useKnownVars } from "../lib/vars.jsx";
import { TARGETS, DEFAULT_TARGET, generate } from "../lib/codegen/index.js";
import { Modal } from "../components/ui/Modal.jsx";
import { Button } from "../components/ui/Button.jsx";
import { AutoComplete } from "../components/ui/AutoComplete.jsx";
import { Checkbox } from "../components/ui/Switch.jsx";
import { toast } from "../components/ui/Toasts.jsx";

const KEY = "snippetTarget";
const read = () => { try { const v = localStorage.getItem(KEY); return TARGETS.some((t) => t.id === v) ? v : DEFAULT_TARGET; } catch { return DEFAULT_TARGET; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

// Language groups first (C#, cURL, Dart …); cURL has no variants so it gets no group heading.
const OPTIONS = TARGETS.map((t) => ({
  value: t.id, label: t.name, group: t.group === t.name ? undefined : t.group,
  full: t.group === t.name ? t.name : `${t.group} – ${t.name}`, search: `${t.group} ${t.name}`.toLowerCase(),
}));
// every typed word must appear in "group name", so "py req" finds Python – Requests and "node ax" finds Node.js – Axios
const filter = (opts, q) => { const words = q.toLowerCase().split(/\s+/).filter(Boolean); return opts.filter((o) => words.every((w) => o.search.includes(w))); };

/** Code snippet for the request exactly as it is in the editor (unsaved changes included). */
export function CodeSnippetModal({ close, tab }) {
  const t = useT();
  const vars = useKnownVars(tab);
  const [target, setTarget] = useState(read);
  const [substitute, setSubstitute] = useState(true);
  const [inherited, setInherited] = useState(null);
  const r = tab.req;

  useEffect(() => {
    if ((r.auth?.type ?? "inherit") !== "inherit" || !tab.collection_id) return;
    let alive = true;
    api("GET", useStore.getState().W(`/collections/${tab.collection_id}/auth`)).then((x) => alive && setInherited(x.auth), () => {});
    return () => { alive = false; };
  }, []);

  const code = useMemo(() => {
    try { return generate(target, r, { vars, inheritedAuth: inherited, substitute }); }
    catch (e) { return `// ${e.message}`; }
  }, [target, r, vars, inherited, substitute]);
  const left = useMemo(() => [...new Set(code.match(/\{\{[^}]+\}\}/g) ?? [])], [code]);
  const copy = () => navigator.clipboard?.writeText(code).then(() => toast(t("common.copied"), "ok"), () => toast(t("common.copyFailed"), "error"));

  return (
    <Modal title={t("snippet.title")} size="lg" onClose={() => close()}>
      <div className="row snippet-bar">
        <AutoComplete className="grow" aria-label={t("snippet.language")} clearable={false} options={OPTIONS} filter={filter}
          value={OPTIONS.find((o) => o.value === target)} onChange={(o) => { if (o) { setTarget(o.value); write(o.value); } }}
          renderChip={(o) => o.full} placeholder={t("snippet.search")} emptyText={t("snippet.none")} />
        <Button icon="copy" data-autofocus onClick={copy}>{t("common.copy")}</Button>
      </div>
      <pre className="snippet" dir="ltr" tabIndex={0} aria-label={t("snippet.code")}>{code}</pre>
      <label className="row snippet-opt"><Checkbox checked={substitute} onChange={setSubstitute} label={t("snippet.substitute")} /> <span>{t("snippet.substitute")}</span></label>
      {left.length > 0 && <div className="muted snippet-note">{t("snippet.left", { vars: left.join(", ") })}</div>}
      <div className="muted snippet-note">{t("snippet.scripts")}</div>
    </Modal>
  );
}
