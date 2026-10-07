import { useEffect, useRef, Fragment } from "react";
import { cx, escapeRe } from "../../lib/utils.js";
import { Icon } from "./Icon.jsx";

export function Highlight({ text = "", q }) {
  if (!q) return text;
  const parts = String(text).split(new RegExp(`(${escapeRe(q)})`, "ig"));
  return parts.map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

// Listbox body shared by AutoComplete, Select, VarInput and the code editor.
export function OptionList({ id, options, active, onPick, onHover, query, renderOption, selected = () => false, empty = "No results", footer }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, options]);
  let lastGroup;
  return (
    <div ref={ref} id={id} role="listbox" className="optlist">
      {options.length === 0 && <div className="opt-empty">{empty}</div>}
      {options.map((o, i) => {
        const head = o.group && o.group !== lastGroup ? <div className="opt-group">{o.group}</div> : null;
        lastGroup = o.group;
        return (
          <Fragment key={o.value ?? i}>
            {head}
            <div
              id={id && `${id}-${i}`}
              role="option"
              aria-selected={selected(o)}
              data-active={i === active}
              className={cx("opt", i === active && "active", selected(o) && "selected", o.disabled && "disabled")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !o.disabled && onPick(o)}
              onMouseMove={() => onHover?.(i)}
            >
              {renderOption ? (
                renderOption(o, { query, active: i === active })
              ) : (
                <>
                  {o.icon && <Icon name={o.icon} className="opt-icon" />}
                  <span className="opt-main">
                    <span className="opt-label"><Highlight text={o.label ?? o.value} q={query} /></span>
                    {o.description && <span className="opt-desc">{o.description}</span>}
                  </span>
                  {selected(o) && <Icon name="check" className="opt-check" />}
                </>
              )}
            </div>
          </Fragment>
        );
      })}
      {footer}
    </div>
  );
}
