import { useMemo, useState } from "react";
import { useStore } from "../../store.js";
import { cx, fmtBytes } from "../../lib/utils.js";
import { statusColor } from "../../lib/http.js";
import { highlightJson, highlightText } from "../../lib/highlight.jsx";
import { Tabs } from "../ui/Tabs.jsx";
import { Button } from "../ui/Button.jsx";
import { Icon, Spinner } from "../ui/Icon.jsx";
import { toast } from "../ui/Toasts.jsx";
import { JsonTree } from "./JsonTree.jsx";
import { t as tr, useT } from "../../i18n/index.js";

const kindOf = (r) => (/json/i.test(r.contentType) ? "json" : /html/i.test(r.contentType) ? "html" : /xml/i.test(r.contentType) ? "xml" : r.binary ? "binary" : "text");
const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast(tr("common.copied"), "ok"), () => toast(tr("common.copyFailed"), "error"));

function Tests({ tests }) {
  const t = useT();
  if (!tests.length) return <div className="muted pad">{t("resp.noTests", { api: "pm.test(...)" })}</div>;
  return (
    <div className="tests">
      {tests.map((x, i) => (
        <div key={i} className={cx("test", x.passed ? "pass" : "fail")}>
          <Icon name={x.passed ? "circle-check" : "circle-xmark"} />
          <div><b>{t(x.passed ? "resp.pass" : "resp.fail")}</b> {x.name}{x.error && <div className="muted">{x.error}</div>}</div>
        </div>
      ))}
    </div>
  );
}
function Headers({ list, q }) {
  const rows = list.filter((x) => !q || (x.key + x.value).toLowerCase().includes(q.toLowerCase()));
  return (
    <table className="htable"><tbody>
      {rows.map((x, i) => <tr key={i}><th>{highlightText(x.key, q)}</th><td>{highlightText(x.value, q)}</td></tr>)}
    </tbody></table>
  );
}
function Sent({ sent }) {
  const t = useT();
  if (!sent) return <div className="muted pad">{t("resp.sentHidden")}</div>;
  return (
    <div className="stack pad">
      {sent.modified && <div className="note"><Icon name="wand-magic-sparkles" /> {t("resp.modifiedNote")}</div>}
      <div className="sent-line"><span className={`m m-${sent.method}`}>{sent.method}</span><code>{sent.url}</code></div>
      <h4>{t("resp.headers")}</h4>
      <Headers list={sent.headers} q="" />
      {sent.body != null && (<><h4>{t("resp.body")}</h4><pre className="raw">{sent.body}</pre></>)}
    </div>
  );
}

export function ResponseViewer({ tab }) {
  const t = useT();
  const setRespView = useStore((s) => s.setRespView);
  const [q, setQ] = useState("");
  const r = tab.response;
  const res = r?.response;
  const kind = res ? kindOf(res) : "text";
  const view = tab.respView ?? (kind === "html" ? "preview" : "pretty");
  const parsed = useMemo(() => {
    if (!res || kind !== "json") return undefined;
    try { return JSON.parse(res.body); } catch { return undefined; }
  }, [res?.body, kind]);

  if (tab.running) return <div className="empty"><div><Spinner /> {t("resp.sending")}</div></div>;
  if (!r) return <div className="empty"><div><Icon name="paper-plane" className="big" /><p>{t("resp.empty")}</p><span className="muted"><kbd>Ctrl</kbd> + <kbd>Enter</kbd></span></div></div>;
  if (r.error && !res)
    return (
      <div className="scroll pad">
        <div className="errbox"><b className="err">{t(r.error.phase === "script" ? "resp.errScript" : r.error.phase === "validation" ? "resp.errValidation" : "resp.errFailed")}</b>{"\n\n"}{r.error.message}</div>
        <Tests tests={r.tests ?? []} />
      </div>
    );

  const passed = r.tests.filter((t) => t.passed).length;
  const tabs = [
    { id: "pretty", label: kind === "json" ? t("resp.pretty") : t("resp.body") },
    { id: "raw", label: t("resp.raw") },
    ...(kind === "html" ? [{ id: "preview", label: t("resp.preview") }] : []),
    { id: "headers", label: t("resp.headers"), badge: res.headers.length },
    { id: "tests", label: t("resp.tests"), badge: r.tests.length ? `${passed}/${r.tests.length}` : false },
    { id: "request", label: t("resp.request"), badge: r.sent?.modified ? "✎" : false, title: t("resp.requestTitle") },
  ];
  const text = parsed !== undefined ? JSON.stringify(parsed, null, 2) : res.body;
  const mod = res.modifiedByScript;

  let body;
  if (view === "headers") body = <Headers list={res.headers} q={q} />;
  else if (view === "tests") body = <Tests tests={r.tests} />;
  else if (view === "request") body = <Sent sent={r.sent} />;
  else if (kind === "binary") {
    const href = URL.createObjectURL(new Blob([Uint8Array.from(atob(res.body), (c) => c.charCodeAt(0))], { type: res.contentType || "application/octet-stream" }));
    body = <div className="pad">{t("resp.binary", { size: fmtBytes(res.size), type: res.contentType || t("resp.unknownType") })} <a href={href} download="response.bin">{t("resp.download")}</a></div>;
  } else if (view === "preview")
    body = <iframe className="preview" sandbox="" referrerPolicy="no-referrer" srcDoc={res.body} title={t("resp.previewTitle")} />;
  else if (view === "pretty" && parsed !== undefined) body = <div className="jt"><JsonTree value={parsed} q={q} /></div>;
  else body = <pre className="raw">{kind === "json" && parsed !== undefined ? highlightJson(text, q) : highlightText(view === "raw" ? text : res.body, q)}</pre>;

  return (
    <div className="resp">
      <div className="resp-meta">
        <span className="pill" style={{ background: statusColor(res.status) }}>{res.status} {res.statusText}</span>
        <span>{res.durationMs} ms</span><span>{fmtBytes(res.size)}</span>
        {res.redirects.length > 0 && <span className="muted">{t("resp.redirects", { n: res.redirects.length })}</span>}
        {mod && <span className="badge-mod" title={t("resp.modTitle", { what: mod.join(", ") })}><Icon name="wand-magic-sparkles" /> {t("resp.modBadge")}</span>}
      </div>
      <div className="resp-bar">
        <Tabs items={tabs} value={view} onChange={(v) => setRespView(tab.key, v)} />
        <div className="grow" />
        {["pretty", "raw", "headers"].includes(view) && <input className="search" type="search" placeholder={t("ui.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("resp.searchLabel")} />}
        <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(view === "headers" ? res.headers.map((x) => `${x.key}: ${x.value}`).join("\n") : view === "request" ? `${r.sent?.method} ${r.sent?.url}` : text)}>{t("common.copy")}</Button>
      </div>
      <div className="scroll">{body}</div>
    </div>
  );
}
