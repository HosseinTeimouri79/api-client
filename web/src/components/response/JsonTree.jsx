import { useState } from "react";
import { highlightText } from "../../lib/highlight.jsx";
import { Icon } from "../ui/Icon.jsx";

const Label = ({ s, q, cls }) => <span className={cls}>{highlightText(String(s), q)}</span>;
/** Collapsible JSON viewer. Children are only rendered while a node is open, so 10 MB payloads stay responsive. */
export function JsonTree({ value, q = "", name = null, depth = 0 }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const k = name == null ? null : <><Label s={JSON.stringify(name)} q={q} cls="j-key" />: </>;
  if (!isObj) {
    const cls = typeof value === "string" ? "j-str" : typeof value === "number" ? "j-num" : value === null ? "j-null" : "j-bool";
    return <div className="j-leaf">{k}<Label s={JSON.stringify(value)} q={q} cls={cls} /></div>;
  }
  const arr = Array.isArray(value), entries = arr ? value.map((x, i) => [i, x]) : Object.entries(value);
  const show = open || !!q;
  return (
    <div className="j-node">
      <div className="j-sum" onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(!open))} aria-expanded={show}>
        <Icon name={show ? "caret-down" : "caret-right"} className="j-caret" />{k}<span className="muted">{arr ? `[ ${entries.length} ]` : `{ ${entries.length} }`}</span>
      </div>
      {show && <div className="j-child">{entries.map(([kk, vv]) => <JsonTree key={kk} value={vv} q={q} name={arr ? null : kk} depth={depth + 1} />)}</div>}
    </div>
  );
}
