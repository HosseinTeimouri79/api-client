import { useRef, useState } from "react";
import { CodeEditor } from "./CodeEditor.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { Menu, useMenu } from "../ui/Menu.jsx";
import { Icon } from "../ui/Icon.jsx";
import { SNIPPETS } from "../../lib/snippets.js";

const HELP = {
  pre: [
    ["pm.request.url / .method", "read or assign"],
    ["pm.request.headers.upsert(k, v)", "add / replace / remove / get"],
    ["pm.request.params.add(k, v)", "query parameters"],
    ["pm.request.body.raw = obj", "rewrite the body (objects are stringified)"],
    ["pm.variables.get(k)", "resolves in every scope"],
    ["pm.globals.set(k, v)", "workspace variable (persisted for editors)"],
    ["CryptoJS.SHA1 / SHA256 / MD5 / HmacSHA256", "hashing + encoders"],
  ],
  post: [
    ["pm.response.json() / text() / code", "read the response"],
    ["pm.response.setBody(x)", "change what the UI shows (object or string)"],
    ["pm.response.setStatus(code, text)", "change the status shown"],
    ["pm.response.setHeader(k, v)", "add / replace a header shown"],
    ["pm.environment.set(k, v)", "save a value for later requests"],
    ["pm.test(name, fn) + pm.expect(x).to…", "assertions (jest and chai style)"],
  ],
};

/** Script box with inherited collection scripts, snippets and an API cheat-sheet. */
export function ScriptEditor({ kind, value, onChange, readOnly, inherited = [], onEditInherited }) {
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
            <b>{list.length} inherited {kind === "pre" ? "pre-request" : "post-request"} script{list.length > 1 ? "s" : ""}</b>
            <span className="muted">run first (outermost → nearest collection), then this request’s own script.</span>
          </div>
          {list.map((x, i) => (
            <details className="inh-item" key={x.id}>
              <summary>
                <span className="inh-n">{i + 1}</span><Icon name="folder" /><span className="nm" title={x.path}>{x.path}</span>
                {onEditInherited && <IconButton icon="pen" label="Edit in collection settings" size="sm" onClick={(e) => { e.preventDefault(); onEditInherited(x.id); }} />}
              </summary>
              <div className="inh-code"><CodeEditor value={x[field]} lang="js" readOnly /></div>
            </details>
          ))}
        </div>
      )}
      <div className="row between">
        <div className="muted">{kind === "pre" ? "Runs before the request is sent. It can change the URL, method, headers, params and body." : "Runs after the response arrives. It can change what the UI shows and write tests."}</div>
        <div className="row">
          {!readOnly && <Button ref={btn} size="sm" icon="wand-magic-sparkles" onClick={() => menu.show(btn.current)}>Snippets</Button>}
          <Button size="sm" variant={help ? "soft" : "default"} icon="circle-question" onClick={() => setHelp(!help)}>API</Button>
        </div>
      </div>
      {help && (
        <div className="help-grid">{HELP[kind].map(([a, b]) => (<div key={a}><code>{a}</code><span>{b}</span></div>))}</div>
      )}
      <div className="grow" style={{ minHeight: 220 }}>
        <CodeEditor value={value ?? ""} lang="js" readOnly={readOnly} onChange={onChange} aria-label={kind === "pre" ? "Pre-request script" : "Post-request script"} placeholder={kind === "pre" ? '// e.g. pm.request.headers.upsert("X-Trace", Date.now());' : "// e.g. pm.test(\"ok\", () => pm.response.to.have.status(200));"} />
      </div>
      <Menu {...menu} onClose={menu.hide} items={SNIPPETS[kind].map((s) => ({ label: s.title, icon: "code", onClick: () => add(s.code) }))} />
    </div>
  );
}
