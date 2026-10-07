import { cx } from "../../lib/utils.js";
export function Checkbox({ checked, onChange, disabled, label, className }) {
  return (
    <input type="checkbox" className={cx("cb", className)} checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
  );
}
export function Field({ label, hint, children, className }) {
  return (
    <label className={cx("field", className)}>
      {label && <span className="field-l">{label}</span>}
      {children}
      {hint && <span className="field-h">{hint}</span>}
    </label>
  );
}
