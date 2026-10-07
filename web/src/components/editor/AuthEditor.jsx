import { Select } from "../ui/Select.jsx";
import { Field } from "../ui/Switch.jsx";
import { VarInput } from "./VarInput.jsx";

const TYPES = [
  { value: "inherit", label: "Inherit from collection", icon: "arrow-up" },
  { value: "none", label: "No auth", icon: "ban" },
  { value: "bearer", label: "Bearer token", icon: "key" },
  { value: "basic", label: "Basic auth", icon: "user-lock" },
  { value: "apikey", label: "API key", icon: "vial" },
];
export function AuthEditor({ auth, onChange, readOnly, allowInherit = true }) {
  const a = auth ?? { type: allowInherit ? "inherit" : "none" };
  const set = (patch) => onChange({ ...a, ...patch });
  const f = (label, key, type) => (
    <Field label={label}><VarInput type={type} value={a[key] ?? ""} readOnly={readOnly} onChange={(v) => set({ [key]: v })} /></Field>
  );
  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <Field label="Type"><Select options={TYPES.filter((t) => allowInherit || t.value !== "inherit")} value={a.type} disabled={readOnly} onChange={(type) => set({ type })} /></Field>
      {a.type === "bearer" && f("Token", "token")}
      {a.type === "basic" && <>{f("Username", "username")}{f("Password", "password", "password")}</>}
      {a.type === "apikey" && (
        <>
          {f("Key name", "key")}
          {f("Value", "value")}
          <Field label="Add to"><Select options={[{ value: "header", label: "Header" }, { value: "query", label: "Query params" }]} value={a.in ?? "header"} disabled={readOnly} onChange={(v) => set({ in: v })} /></Field>
        </>
      )}
      <div className="muted">Tip: type <code>{"{{"}</code> to pick a variable such as <code>{"{{token}}"}</code>.</div>
    </div>
  );
}
