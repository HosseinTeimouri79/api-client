import { forwardRef } from "react";
import { cx } from "../../lib/utils.js";
import { Icon } from "./Icon.jsx";

export const Button = forwardRef(function Button(
  { variant = "default", size = "md", icon, loading, className, children, type = "button", ...p },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx("btn", `btn-${variant}`, `btn-${size}`, className)} disabled={p.disabled || loading} {...p}>
      {loading ? <Icon name="circle-notch" spin /> : icon ? <Icon name={icon} /> : null}
      {children != null && children !== false && <span className="btn-label">{children}</span>}
    </button>
  );
});
export const IconButton = forwardRef(function IconButton({ icon, label, className, size = "md", ...p }, ref) {
  return (
    <button ref={ref} type="button" className={cx("btn btn-ghost btn-icon", `btn-${size}`, className)} aria-label={label} title={label} {...p}>
      <Icon name={icon} />
    </button>
  );
});
