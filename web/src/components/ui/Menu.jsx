import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/utils.js";
import { Popover } from "./Popover.jsx";
import { Icon } from "./Icon.jsx";

/** items: [{ label, icon, onClick, danger, disabled } | "-"]. anchor: element or {x,y}. */
export function Menu({ anchor, open, onClose, items, placement }) {
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const actionable = items.map((it, i) => [it, i]).filter(([it]) => it !== "-" && !it.disabled).map(([, i]) => i);
  useEffect(() => { if (open) { setActive(actionable[0] ?? 0); setTimeout(() => ref.current?.focus(), 0); } }, [open]);
  const key = (e) => {
    const pos = actionable.indexOf(active);
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(actionable[(pos + 1) % actionable.length]); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(actionable[(pos - 1 + actionable.length) % actionable.length]); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); onClose(); }
  };
  const run = (it) => { if (!it || it === "-" || it.disabled) return; onClose(); it.onClick?.(); };
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} placement={placement} className="menu" maxHeight={420}>
      <div ref={ref} role="menu" tabIndex={-1} onKeyDown={key} className="menu-in">
        {items.map((it, i) => it === "-" ? <hr key={i} /> : (
          <div key={i} role="menuitem" aria-disabled={it.disabled} className={cx("menu-item", i === active && "active", it.danger && "danger", it.disabled && "disabled")} onMouseEnter={() => setActive(i)} onClick={() => run(it)}>
            {it.leading ?? <Icon name={it.icon ?? "angle-right"} className={cx(!it.icon && "invisible")} />}
            <span>{it.label}</span>
          </div>
        ))}
      </div>
    </Popover>
  );
}
/** Button-anchored menu helper */
export function useMenu() {
  const [state, set] = useState({ open: false, anchor: null });
  return { ...state, show: (anchor) => set({ open: true, anchor }), hide: () => set((s) => ({ ...s, open: false })) };
}
