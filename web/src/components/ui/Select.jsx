import { useId, useMemo, useRef, useState } from "react";
import { cx, fuzzy } from "../../lib/utils.js";
import { Popover } from "./Popover.jsx";
import { OptionList } from "./OptionList.jsx";
import { Icon } from "./Icon.jsx";
import { useT } from "../../i18n/index.js";

/** Custom dropdown (replaces <select>). Becomes searchable when there are many options. */
export function Select({ value, onChange, options, placeholder, disabled, searchable, className, renderValue, renderOption, size, "aria-label": aria, title }) {
  const id = useId();
  const t = useT();
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const canSearch = searchable ?? options.length > 8;
  const list = useMemo(
    () => (q ? options.map((o) => [o, Math.max(fuzzy(o.label ?? String(o.value), q), fuzzy(o.search ?? "", q))]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([o]) => o) : options),
    [options, q],
  );
  const cur = options.find((o) => o.value === value);
  const show = () => { setQ(""); setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (o) => { onChange(o.value); setOpen(false); btn.current?.focus(); };
  const key = (e) => {
    if (!open) { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); list[active] && pick(list[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
    else if (!canSearch && e.key.length === 1) { const i = list.findIndex((o) => (o.label ?? "").toLowerCase().startsWith(e.key.toLowerCase())); if (i >= 0) setActive(i); }
  };
  return (
    <>
      <button ref={btn} type="button" className={cx("select", size && `select-${size}`, open && "open", className)} disabled={disabled} title={title} aria-label={aria} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={key}>
        <span className={cx("select-value", !cur && "placeholder")}>{cur ? (renderValue ? renderValue(cur) : <>{cur.icon && <Icon name={cur.icon} />}{cur.label}</>) : (placeholder ?? t("ui.select"))}</span>
        <Icon name="chevron-down" className="select-caret" />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} matchWidth={false} className="select-pop" ignore={btn.current}>
        {canSearch && (
          <input className="select-search" autoFocus placeholder={t("ui.search")} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={key} aria-label={t("ui.searchOptions")} />
        )}
        <OptionList id={`${id}-list`} options={list} active={active} onHover={setActive} onPick={pick} query={q} selected={(o) => o.value === value} renderOption={renderOption && ((o, ctx) => renderOption(o, { ...ctx, close: () => setOpen(false) }))} />
      </Popover>
    </>
  );
}
