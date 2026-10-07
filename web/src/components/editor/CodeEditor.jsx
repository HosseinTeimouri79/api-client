import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { cx, fuzzy } from "../../lib/utils.js";
import { highlightJs, highlightJson } from "../../lib/highlight.jsx";
import { PM_COMPLETIONS } from "../../lib/snippets.js";
import { useVars, varOptions } from "../../lib/vars.jsx";
import { useStore } from "../../store.js";
import { indentUnit } from "../../lib/settings.js";
import { useT } from "../../i18n/index.js";
import { Popover } from "../ui/Popover.jsx";
import { OptionList } from "../ui/OptionList.jsx";
import { Button } from "../ui/Button.jsx";

const MAX_HL = 200_000; // beyond this, skip highlighting to keep typing instant
const COPY = ["fontFamily", "fontSize", "lineHeight", "letterSpacing", "tabSize", "paddingTop", "paddingLeft", "paddingRight", "paddingBottom", "borderTopWidth", "borderLeftWidth"];
function caretPoint(ta) {
  const cs = getComputedStyle(ta), m = document.createElement("div");
  COPY.forEach((p) => (m.style[p] = cs[p]));
  Object.assign(m.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre", top: 0, left: 0, boxSizing: "border-box" });
  m.textContent = ta.value.slice(0, ta.selectionStart);
  const s = document.createElement("span");
  s.textContent = "\u200b";
  m.append(s);
  document.body.append(m);
  const x = s.offsetLeft, y = s.offsetTop, lh = parseFloat(cs.lineHeight) || 18;
  m.remove();
  const r = ta.getBoundingClientRect();
  return { x: r.left + x - ta.scrollLeft, y: r.top + y - ta.scrollTop + lh };
}
// Insert through the browser so Ctrl+Z keeps working; fall back to setRangeText.
function insert(ta, text, from = ta.selectionStart, to = ta.selectionEnd) {
  ta.focus();
  ta.setSelectionRange(from, to);
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, from, to, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

const PAIRS = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set(Object.values(PAIRS));
const word = (c) => /\w/.test(c ?? "");

/** Code box: syntax highlighting, JSON validation, {{variable}} and pm.* completions. lang: json | js | text */
export function CodeEditor({ value, onChange, lang = "text", readOnly, placeholder, className, "aria-label": aria }) {
  const ta = useRef(null), pre = useRef(null);
  const vars = useVars();
  const t = useT();
  const ed = useStore((s) => s.settings.editor); // Settings → Editor
  const unit = indentUnit(ed);
  const [ac, setAc] = useState(null); // { kind, q, from, to, point }
  const [active, setActive] = useState(0);

  const hl = useMemo(() => (value.length > MAX_HL ? value : lang === "json" ? highlightJson(value) : lang === "js" ? highlightJs(value) : value), [value, lang]);
  const err = useMemo(() => {
    if (lang !== "json" || !value.trim()) return null;
    try { JSON.parse(value.replace(/\{\{[^{}]*\}\}/g, "0")); return false; } catch (e) { return e.message; }
  }, [value, lang]);
  useLayoutEffect(() => { if (pre.current && ta.current) { pre.current.scrollTop = ta.current.scrollTop; pre.current.scrollLeft = ta.current.scrollLeft; } });

  const options = useMemo(() => {
    if (!ac) return [];
    const base = ac.kind === "var" ? varOptions(vars) : PM_COMPLETIONS;
    const q = ac.q;
    return base.map((o) => [o, ac.kind === "js" ? (o.value.toLowerCase().startsWith(q.toLowerCase()) ? 100 : fuzzy(o.value, q) / 2) : fuzzy(o.value, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([o]) => o);
  }, [ac, vars]);

  const detect = (el) => {
    if (readOnly) return setAc(null);
    const pos = el.selectionStart, before = el.value.slice(0, pos);
    const v = /\{\{\s*([\w.\-]*)$/.exec(before);
    if (v) return (setAc({ kind: "var", q: v[1], from: pos - v[1].length, to: pos, open: pos - v[0].length, point: caretPoint(el) }), setActive(0));
    if (lang === "js") {
      const w = /[\w$]+(?:\.[\w$]*)*$/.exec(before);
      if (w && (w[0].length >= 2 || w[0].includes("."))) return (setAc({ kind: "js", q: w[0], from: pos - w[0].length, to: pos, point: caretPoint(el) }), setActive(0));
    }
    setAc(null);
  };
  const open = !!ac && options.length > 0 && !(ac.kind === "js" && options.length === 1 && options[0].value === ac.q);
  const pick = (o) => {
    const el = ta.current;
    if (ac.kind === "var") {
      const close = /^\s*\}\}/.exec(el.value.slice(ac.to));
      insert(el, `${o.value}}}`, ac.from, ac.to + (close ? close[0].length : 0));
    } else insert(el, o.value, ac.from, ac.to);
    setAc(null);
  };
  const key = (e) => {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); return setActive((a) => Math.min(a + 1, options.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); return setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return pick(options[active]); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return setAc(null); }
    }
    if (readOnly) return;
    const el = e.target, a = el.selectionStart, b = el.selectionEnd, v = el.value, plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); insert(el, unit); return; }
    if (e.key === "Enter" && plain && lang !== "text") {
      // keep indentation of the current line
      const line = v.slice(0, a).split("\n").at(-1), ind = /^\s*/.exec(line)[0] + (/[{[(]$/.test(line.trimEnd()) ? unit : "");
      if (ind) { e.preventDefault(); insert(el, "\n" + ind); }
      return;
    }
    if (lang === "text" || !plain) return;
    const quotes = lang === "json" ? ['"'] : ['"', "'", "`"];
    const brackets = ed.autoCloseBrackets, quoting = ed.autoCloseQuotes;
    // typing a closer that is already there just steps over it
    if (a === b && v[a] === e.key && ((brackets && CLOSERS.has(e.key)) || (quoting && quotes.includes(e.key)))) { e.preventDefault(); el.setSelectionRange(a + 1, a + 1); return; }
    const close = brackets && PAIRS[e.key] ? PAIRS[e.key] : quoting && quotes.includes(e.key) ? e.key : null;
    if (close && (a !== b || (!word(v[a]) && !(quotes.includes(e.key) && word(v[a - 1]))))) {
      e.preventDefault();
      insert(el, e.key + v.slice(a, b) + close); // wraps a selection, otherwise inserts the pair
      el.setSelectionRange(a + 1, b + 1);
      return;
    }
    // Backspace between an empty pair removes both halves
    if (e.key === "Backspace" && a === b && a > 0) {
      if ((brackets && PAIRS[v[a - 1]] === v[a]) || (quoting && quotes.includes(v[a - 1]) && v[a - 1] === v[a])) {
        e.preventDefault();
        el.setSelectionRange(a - 1, a + 1);
        if (!document.execCommand("delete")) { el.setRangeText("", a - 1, a + 1, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    }
  };
  const format = () => { try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch { /* error shown below */ } };

  return (
    <div className={cx("code-wrap", className)}>
      {lang === "json" && (
        <div className="code-tools">
          <Button size="sm" variant="ghost" icon="align-left" onClick={format} disabled={readOnly || err !== false}>{t("code.format")}</Button>
          <span className={cx("code-status", err ? "err" : err === false ? "ok" : "")}>{err === false ? t("code.validJson") : err || ""}</span>
        </div>
      )}
      <div className="code">
        <pre ref={pre} aria-hidden="true">{hl}{"\n"}</pre>
        <textarea
          ref={ta} value={value} readOnly={readOnly} placeholder={placeholder} spellCheck={false} aria-label={aria} wrap="off"
          onChange={(e) => { onChange(e.target.value); detect(e.target); }}
          onScroll={(e) => { pre.current.scrollTop = e.target.scrollTop; pre.current.scrollLeft = e.target.scrollLeft; if (ac) setAc(null); }}
          onKeyDown={key} onBlur={() => setTimeout(() => setAc(null), 120)} onClick={() => setAc(null)}
        />
      </div>
      <Popover anchor={ac?.point} open={open} onClose={() => setAc(null)} className="code-pop" maxHeight={220}>
        <OptionList options={options} active={active} onHover={setActive} onPick={pick} query={ac?.q} />
      </Popover>
    </div>
  );
}
