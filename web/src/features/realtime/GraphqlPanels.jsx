import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../store.js";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { Field } from "../../components/ui/Switch.jsx";
import { useT } from "../../i18n/index.js";

/** Keeps the tab's view of its GraphQL document (operations, which one runs, syntax errors) up to date. */
function useAnalysis(tab) {
  const { query = "", operationName = "" } = tab.req.protocol_data ?? {};
  const forKey = `${query}\u0000${operationName}`;
  useEffect(() => {
    if (tab.gql?.forKey === forKey) return;
    const id = setTimeout(() => useStore.getState().analyzeQuery(tab.key), tab.gql ? 300 : 0);
    return () => clearTimeout(id);
  }, [forKey, tab.gql?.forKey, tab.key]);
  return tab.gql;
}

export function GraphqlQuery({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const a = useAnalysis(tab);
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const ops = a?.operations ?? [];
  // the chosen operation no longer exists in the edited document: fall back to "whichever the document has"
  useEffect(() => {
    if (a?.ok && d.operationName && !ops.some((o) => o.name === d.operationName)) patch({ operationName: "" });
  }, [a, d.operationName]);
  const send = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); useStore.getState().send(tab.key); } };
  return (
    <div className="stack fill">
      <div className="row wrap">
        {a?.current && <span className={`gql-type gql-${a.current.type}`}>{t(`gql.type.${a.current.type}`)}</span>}
        {ops.length > 1 && (
          <Select className="grow" value={d.operationName ?? ""} placeholder={t("gql.chooseOperation")} aria-label={t("gql.operation")} options={ops.map((o) => ({ value: o.name, label: o.name || t("gql.anonymous"), description: t(`gql.type.${o.type}`) }))}
            renderOption={(o) => <span className="proto-opt">{o.label}<em>{o.description}</em></span>} onChange={(operationName) => patch({ operationName })} />
        )}
        {a?.ambiguous && <span className="warn">{t("gql.chooseHint")}</span>}
      </div>
      <textarea className="mono ws-compose gql-query" spellCheck={false} placeholder={t("gql.queryPlaceholder")} aria-label={t("gql.query")} value={d.query ?? ""} onChange={(e) => patch({ query: e.target.value })} onKeyDown={send} />
      {a && !a.ok && <div className="note err" role="alert">{a.error}{a.line ? ` (${t("gql.at", { line: a.line, column: a.column })})` : ""}</div>}
      <Field label={t("gql.variables")}>
        <textarea className="mono ws-compose gql-vars" rows={5} spellCheck={false} placeholder={t("gql.variablesPlaceholder")} aria-label={t("gql.variables")} value={d.variables ?? ""} onChange={(e) => patch({ variables: e.target.value })} onKeyDown={send} />
      </Field>
    </div>
  );
}

/** The schema as SDL, fetched by introspection, with a filter that keeps the matching type blocks. */
export function GraphqlSchema({ tab }) {
  const t = useT();
  const { introspect } = useStore.getState();
  const s = tab.schema;
  const [q, setQ] = useState("");
  const blocks = useMemo(() => {
    if (!s?.sdl) return [];
    const all = s.sdl.split(/\n\n+/);
    const w = q.trim().toLowerCase();
    return w ? all.filter((b) => b.toLowerCase().includes(w)) : all;
  }, [s?.sdl, q]);
  return (
    <div className="stack fill">
      <div className="row wrap">
        <Button icon="cloud-arrow-down" loading={s?.loading} onClick={() => introspect(tab.key)}>{s?.sdl ? t("gql.refetch") : t("gql.fetch")}</Button>
        {s?.sdl && <div className="searchbox grow"><Icon name="magnifying-glass" /><input type="search" placeholder={t("gql.filter")} value={q} aria-label={t("gql.filter")} onChange={(e) => setQ(e.target.value)} /></div>}
      </div>
      {s?.error && <div className="note err" role="alert">{s.error}</div>}
      {!s && <div className="muted">{t("gql.schemaHint")}</div>}
      {s?.sdl && (blocks.length ? <pre className="raw gql-sdl" dir="ltr">{blocks.join("\n\n")}</pre> : <div className="muted">{t("gql.noMatch")}</div>)}
    </div>
  );
}

const METHODS = ["POST", "GET"].map((m) => ({ value: m, label: m }));
export function GraphqlSettings({ tab }) {
  const t = useT();
  const { setReq } = useStore.getState();
  const d = tab.req.protocol_data ?? {};
  const patch = (p) => setReq(tab.key, { protocol_data: { ...d, ...p } });
  const transports = [{ value: "graphql-transport-ws", label: t("gql.transport.modern") }, { value: "graphql-ws", label: t("gql.transport.legacy") }];
  return (
    <div className="stack">
      <Field label={t("gql.httpMethod")} hint={t("gql.httpMethodHint")}>
        <Select className="short" value={d.httpMethod ?? "POST"} options={METHODS} onChange={(httpMethod) => patch({ httpMethod })} aria-label={t("gql.httpMethod")} />
      </Field>
      <h4>{t("gql.subscriptions")}</h4>
      <Field label={t("gql.transport")}>
        <Select value={d.transport ?? "graphql-transport-ws"} options={transports} onChange={(transport) => patch({ transport })} aria-label={t("gql.transport")} />
      </Field>
      <Field label={t("gql.wsUrl")} hint={t("gql.wsUrlHint")}>
        <input value={d.wsUrl ?? ""} placeholder="wss://api.example.com/graphql" onChange={(e) => patch({ wsUrl: e.target.value })} />
      </Field>
      <Field label={t("gql.connectionParams")} hint={t("gql.connectionParamsHint")}>
        <textarea className="mono" rows={4} spellCheck={false} placeholder='{ "authToken": "{{token}}" }' value={d.connectionParams ?? ""} onChange={(e) => patch({ connectionParams: e.target.value })} />
      </Field>
    </div>
  );
}
