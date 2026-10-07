import { useRef, useState } from "react";
import { CodeEditor } from "./CodeEditor.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { Menu, useMenu } from "../ui/Menu.jsx";
import { Icon } from "../ui/Icon.jsx";
import { SNIPPETS } from "../../lib/snippets.js";
import { useT } from "../../i18n/index.js";

// left column: the API (code, never translated); right column: i18n key of its description
const HELP = {
  pre: [
    ["pm.request.url / .method", "help.pre.1"],
    ["pm.request.headers.upsert(k, v)", "help.pre.2"],
    ["pm.request.params.add(k, v)", "help.pre.3"],
    ["pm.request.body.raw = obj", "help.pre.4"],
    ["pm.variables.get(k)", "help.pre.5"],
    ["pm.globals.set(k, v)", "help.pre.6"],
    ["CryptoJS.SHA1 / SHA256 / MD5 / HmacSHA256", "help.pre.7"],
  ],
  post: [
    ["pm.response.json() / text() / code", "help.post.1"],
    ["pm.response.setBody(x)", "help.post.2"],
    ["pm.response.setStatus(code, text)", "help.post.3"],
    ["pm.response.setHeader(k, v)", "help.post.4"],
    ["pm.environment.set(k, v)", "help.post.5"],
    ["pm.test(name, fn) + pm.expect(x).to…", "help.post.6"],
  ],
};

/** Script box with inherited collection scripts, snippets and an API cheat-sheet. */
export function ScriptEditor({ kind, value, onChange, readOnly, inherited = [], onEditInherited }) {
  const t = useT();
  const menu = useMenu();
  const btn = useRef(null);
  const [help, setHelp] = useState(false);
  const field = kind === "pre" ? "pre_script" : "post_script";
  const list = inherited.filter((x) => x[field]?.trim());
  const add = (code) => onChange(value && !value.endsWith("\n") ? `${value}\n${code}` : value + code);
  return (
    <div className="stack fill">
      {list.length > 0 && (
        <div className="inh">
          <div className="inh-h">
            <Icon name="folder-tree" />
            <b>{t(kind === "pre" ? "script.inheritedPre" : "script.inheritedPost", { n: list.length })}</b>
            <span className="muted">{t("script.inheritedHint")}</span>
          </div>
          {list.map((x, i) => (
            <details className="inh-item" key={x.id}>
              <summary>
                <span className="inh-n">{i + 1}</span><Icon name="folder" /><span className="nm" title={x.path}>{x.path}</span>
                {onEditInherited && <IconButton icon="pen" label={t("script.editInCollection")} size="sm" onClick={(e) => { e.preventDefault(); onEditInherited(x.id); }} />}
              </summary>
              <div className="inh-code"><CodeEditor value={x[field]} lang="js" readOnly /></div>
            </details>
          ))}
        </div>
      )}
      <div className="row between">
        <div className="muted">{t(kind === "pre" ? "script.preHint" : "script.postHint")}</div>
        <div className="row">
          {!readOnly && <Button ref={btn} size="sm" icon="wand-magic-sparkles" onClick={() => menu.show(btn.current)}>{t("script.snippets")}</Button>}
          <Button size="sm" variant={help ? "soft" : "default"} icon="circle-question" onClick={() => setHelp(!help)}>{t("script.api")}</Button>
        </div>
      </div>
      {help && (
        <div className="help-grid">{HELP[kind].map(([a, b]) => (<div key={a}><code>{a}</code><span>{t(b)}</span></div>))}</div>
      )}
      <div className="grow" style={{ minHeight: 220 }}>
        <CodeEditor value={value ?? ""} lang="js" readOnly={readOnly} onChange={onChange} aria-label={t(kind === "pre" ? "script.preLabel" : "script.postLabel")} placeholder={kind === "pre" ? '// pm.request.headers.upsert("X-Trace", Date.now());' : '// pm.test("ok", () => pm.response.to.have.status(200));'} />
      </div>
      <Menu {...menu} onClose={menu.hide} items={SNIPPETS[kind].map((s) => ({ label: t(s.title), icon: "code", onClick: () => add(s.code) }))} />
    </div>
  );
}
