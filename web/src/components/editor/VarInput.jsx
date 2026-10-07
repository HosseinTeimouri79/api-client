import { useMemo, useRef, useState, useId } from "react";
import { cx, fuzzy } from "../../lib/utils.js";
import { useVars, varOptions } from "../../lib/vars.jsx";
import { Popover } from "../ui/Popover.jsx";
import { OptionList } from "../ui/OptionList.jsx";

const VAR = /(\{\{[^{}]*\}\})/g;
const TRIGGER = /\{\{\s*([\w.\-]*)$/;

/**
 * Text input that understands {{variables}}:
 *  - highlights known (green) / unknown (amber) variables,
 *  - suggests variable names after typing "{{",
 *  - optionally suggests free-form values (`suggestions`, e.g. header names).
 */
export function VarInput({ value, onChange, placeholder, suggestions, readOnly, className, type = "text", onKeyDown, onFocus, onBlur, autoFocus, "aria-label": aria, inputRef }) {
  const id = useId();
  const vars = useVars();
  const wrap = useRef(null), input = useRef(null), mirror = useRef(null);
  const [focus, setFocus] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const masked = type === "password";

  const ctx = useMemo(() => {
    const m = TRIGGER.exec(value.slice(0, caret));
    if (m) return { kind: "var", q: m[1], from: caret - m[0].length };
    return suggestions?.length ? { kind: "sugg", q: value, from: 0 } : null;
  }, [value, caret, suggestions]);

  const options = useMemo(() => {
    if (!ctx) return [];
    const base = ctx.kind === "var" ? varOptions(vars) : suggestions;
    if (!ctx.q) return base.slice(0, 50);
    return base.map((o) => [o, fuzzy(o.label ?? o.value, ctx.q)]).filter(([o, s]) => s > 0 && !(ctx.kind === "sugg" && o.value === ctx.q)).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([o]) => o);
  }, [ctx, vars, suggestions]);
  const open = focus && !readOnly && !dismissed && options.length > 0;

  const pick = (o) => {
    let next, pos;
    if (ctx.kind === "var") {
      const after = value.slice(caret).replace(/^[\w.\-]*\s*\}\}/, "");
      next = `${value.slice(0, ctx.from)}{{${o.value}}}${after}`;
      pos = ctx.from + o.value.length + 4;
    } else { next = o.value; pos = next.length; }
    onChange(next);
    setDismissed(false);
    requestAnimationFrame(() => { input.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };
  const key = (e) => {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
      if ((e.key === "Enter" || e.key === "Tab") && options[active]) { e.preventDefault(); pick(options[active]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDismissed(true); return; }
    }
    onKeyDown?.(e);
  };
  const sync = () => { if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft; };
  const parts = useMemo(() => (masked ? [value.replace(/./g, "•")] : value.split(VAR)), [value, masked]);

  return (
    <div ref={wrap} className={cx("vi", className, readOnly && "ro")}>
      <div ref={mirror} className="vi-mirror" aria-hidden="true">
        {parts.map((p, i) => {
          const m = /^\{\{\s*([\w.\-]*)\s*\}\}$/.exec(p);
          return m ? <span key={i} className={cx("vi-var", m[1] in vars ? "ok" : "bad")}>{p}</span> : p;
        })}
        {"\u200b"}
      </div>
      <input
        ref={(el) => { input.current = el; if (inputRef) inputRef.current = el; }}
        type={type} value={value} placeholder={placeholder} readOnly={readOnly} spellCheck={false} autoComplete="off" autoFocus={autoFocus} aria-label={aria}
        role={open ? "combobox" : undefined} aria-expanded={open || undefined} aria-controls={open ? `${id}-l` : undefined} aria-activedescendant={open ? `${id}-l-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? 0); setDismissed(false); setActive(0); requestAnimationFrame(sync); }}
        onKeyDown={key}
        onKeyUp={(e) => setCaret(e.target.selectionStart ?? 0)}
        onClick={(e) => setCaret(e.target.selectionStart ?? 0)}
        onScroll={sync}
        onFocus={(e) => { setFocus(true); setDismissed(false); onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      />
      <Popover anchor={wrap.current} open={open} onClose={() => setDismissed(true)} matchWidth={ctx?.kind === "sugg"} className="vi-pop" maxHeight={240}>
        <OptionList id={`${id}-l`} options={options} active={active} onHover={setActive} onPick={pick} query={ctx?.q} />
      </Popover>
    </div>
  );
}
