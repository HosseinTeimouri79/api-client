import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx, fuzzy } from "../../lib/utils.js";
import { Popover } from "./Popover.jsx";
import { OptionList } from "./OptionList.jsx";
import { Icon, Spinner } from "./Icon.jsx";
import { Avatar } from "./Avatar.jsx";
import { useT } from "../../i18n/index.js";

/**
 * AutoComplete / combobox.
 *   options        static list  [{ value, label, description?, group?, icon?, ...anything }]
 *   loadOptions    async (query) => options   (debounced; used instead of / on top of `options`)
 *   value          single: option object | null      multiple: option object[]
 *   onChange       receives the same shape
 *   multiple       chips + keep open
 *   creatable      offer "Create “text”" -> onCreate(text) (defaults to returning {value:text,label:text})
 *   renderOption / renderChip   customise rows / chips (members picker shows avatars)
 */
export function AutoComplete({
  options = [], loadOptions, value, onChange, multiple = false, placeholder, disabled, clearable = true,
  creatable, onCreate, emptyText, renderOption, renderChip, filter, className, autoFocus, id: idProp, "aria-label": ariaLabel,
}) {
  const uid = useId();
  const t = useT();
  const id = idProp ?? uid;
  const wrapRef = useRef(null), inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const selected = multiple ? (value ?? []) : value ? [value] : [];
  const isSel = (o) => selected.some((s) => s.value === o.value);

  // async options, debounced; stale responses are ignored
  useEffect(() => {
    if (!loadOptions || !open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await loadOptions(query);
        if (alive) setRemote(r);
      } catch {
        if (alive) setRemote([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, query ? 180 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [query, open, loadOptions]);

  const list = useMemo(() => {
    const base = remote ?? options;
    let out;
    if (loadOptions) out = base; // server already filtered
    else if (filter) out = filter(base, query);
    else if (!query) out = base;
    else out = base.map((o) => [o, Math.max(fuzzy(o.label ?? String(o.value), query), fuzzy(o.description ?? "", query) / 4)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([o]) => o);
    if (multiple) out = out.filter((o) => !isSel(o));
    const q = query.trim();
    if (creatable && q && !out.some((o) => (o.label ?? o.value) === q))
      out = [...out, { value: q, label: t("ui.create", { q }), create: true, icon: "plus" }];
    return out;
  }, [remote, options, query, value, loadOptions, filter, creatable, multiple]);
  useEffect(() => setActive(0), [list.length, query]);

  const commit = (o) => {
    const v = o.create ? (onCreate ? onCreate(o.value) : { value: o.value, label: o.value }) : o;
    if (multiple) { onChange([...selected, v]); setQuery(""); inputRef.current?.focus(); }
    else { onChange(v); setQuery(""); dismiss(); }
  };
  // Closing the list also drops focus, so the next click on the field opens it again (and autofocus never pops it open).
  const dismiss = () => { setOpen(false); inputRef.current?.blur(); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && list[active]) { e.preventDefault(); commit(list[active]); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); dismiss(); }
    else if (e.key === "Backspace" && !query && multiple && selected.length) onChange(selected.slice(0, -1));
    else if (e.key === "Tab") setOpen(false);
  };
  const single = !multiple && value;
  const chip = (o) => (renderChip ? renderChip(o) : <span className="chip-label">{o.label}</span>);

  return (
    <div ref={wrapRef} className={cx("ac", open && "open", disabled && "disabled", multiple && "multi", className)} onClick={(e) => { if (disabled || !wrapRef.current?.contains(e.target)) return; inputRef.current?.focus(); setOpen(true); }}>
      {multiple && selected.map((o) => (
        <span className="chip" key={o.value}>
          {chip(o)}
          {!disabled && (
            <button type="button" className="chip-x" aria-label={t("ui.removeItem", { name: o.label })} onClick={(e) => { e.stopPropagation(); onChange(selected.filter((s) => s.value !== o.value)); }}>
              <Icon name="xmark" />
            </button>
          )}
        </span>
      ))}
      {single && !query && <span className="ac-single">{renderChip ? renderChip(value) : value.label}</span>}
      <input
        ref={inputRef} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-label={ariaLabel}
        aria-activedescendant={open && list[active] ? `${id}-list-${active}` : undefined}
        autoFocus={autoFocus} disabled={disabled} autoComplete="off" spellCheck={false}
        placeholder={selected.length && !query ? (multiple ? "" : "") : placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      {loading ? <Spinner className="ac-spin" /> : clearable && !multiple && value && !disabled ? (
        <button type="button" className="ac-clear" aria-label={t("ui.clear")} onClick={(e) => { e.stopPropagation(); onChange(null); }}><Icon name="xmark" /></button>
      ) : <Icon name="chevron-down" className="ac-caret" />}
      <Popover anchor={wrapRef.current} open={open && !disabled} onClose={() => setOpen(false)} matchWidth>
        <OptionList id={`${id}-list`} options={list} active={active} onHover={setActive} onPick={commit} query={query} selected={isSel} renderOption={renderOption} empty={loading ? t("ui.searching") : (emptyText ?? t("ui.noResults"))} />
      </Popover>
    </div>
  );
}

// People picker used by "add members": multi-select with avatars, results fetched from the server as you type.
export const personOption = (u) => ({ value: u.id, label: u.name || u.username, description: `@${u.username}`, user: u });
export const renderPerson = (o, { query } = {}) => (
  <>
    <Avatar name={o.user?.name || o.label} src={o.user?.avatar} size={26} />
    <span className="opt-main"><span className="opt-label">{o.label}</span><span className="opt-desc">{o.description}</span></span>
  </>
);
export const renderPersonChip = (o) => (<><Avatar name={o.label} src={o.user?.avatar} size={18} /><span className="chip-label">{o.label}</span></>);
