import { Checkbox } from "../ui/Switch.jsx";
import { IconButton } from "../ui/Button.jsx";
import { VarInput } from "./VarInput.jsx";
import { cx } from "../../lib/utils.js";

const GHOST = { key: "", value: "", enabled: true };
/**
 * Editable key/value table with a trailing blank row. Immutable: always calls onChange(newRows).
 * keySuggestions: [{value, description}]; valueSuggestions(key) -> string[]
 */
export function KeyValueEditor({ rows, onChange, readOnly, keySuggestions, valueSuggestions, keyPlaceholder = "Key", valuePlaceholder = "Value", className }) {
  const shown = readOnly ? rows : [...rows, GHOST];
  const set = (i, patch) => onChange(i === rows.length ? [...rows, { ...GHOST, ...patch }] : rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className={cx("kv", className)} role="table">
      {shown.map((r, i) => {
        const ghost = !readOnly && i === rows.length;
        const vs = valueSuggestions?.(r.key)?.map((v) => ({ value: v, label: v }));
        return (
          <div className={cx("kv-row", ghost && "ghost", r.enabled === false && "off")} role="row" key={i}>
            <span className="kv-cb">{!ghost && <Checkbox checked={r.enabled !== false} disabled={readOnly} onChange={(v) => set(i, { enabled: v })} label="Enabled" />}</span>
            <VarInput value={r.key} placeholder={keyPlaceholder} readOnly={readOnly} suggestions={keySuggestions} aria-label="Key" onChange={(v) => set(i, { key: v })} />
            <VarInput value={r.value} placeholder={valuePlaceholder} readOnly={readOnly} suggestions={vs} aria-label="Value" onChange={(v) => set(i, { value: v })} />
            <span className="kv-x">{!ghost && !readOnly && <IconButton icon="xmark" label="Remove" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} />}</span>
          </div>
        );
      })}
    </div>
  );
}
