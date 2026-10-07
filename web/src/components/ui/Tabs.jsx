import { cx } from "../../lib/utils.js";

/** Segmented / sub-tab strip. items: [{ id, label, badge?, title? }] */
export function Tabs({ items, value, onChange, className, variant = "line" }) {
  return (
    <div className={cx("tabstrip", `tabstrip-${variant}`, className)} role="tablist">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} type="button" title={t.title} className={cx("tabstrip-i", value === t.id && "on")} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge != null && t.badge !== false && <span className="count">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
