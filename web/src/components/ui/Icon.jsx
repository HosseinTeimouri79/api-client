import { cx } from "../../lib/utils.js";
import { useT } from "../../i18n/index.js";
// Font Awesome (self-hosted) glyph. name: "folder-open", style: "solid" | "regular"
export function Icon({ name, style = "solid", className, spin, ...p }) {
  return <i className={cx(`fa-${style} fa-${name}`, spin && "fa-spin", className)} aria-hidden="true" {...p} />;
}
export function Spinner({ className }) {
  const t = useT();
  return <span className={cx("spin", className)} role="status" aria-label={t("common.loading")} />;
}
