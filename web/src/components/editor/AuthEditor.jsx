import { Select } from "../ui/Select.jsx";
import { Field } from "../ui/Switch.jsx";
import { VarInput } from "./VarInput.jsx";
import { useT } from "../../i18n/index.js";

export function AuthEditor({ auth, onChange, readOnly, allowInherit = true }) {
  const t = useT();
  const TYPES = [
    { value: "inherit", label: t("auth.inherit"), icon: "arrow-up" },
    { value: "none", label: t("auth.none"), icon: "ban" },
    { value: "bearer", label: t("auth.bearer"), icon: "key" },
    { value: "basic", label: t("auth.basic"), icon: "user-lock" },
    { value: "apikey", label: t("auth.apikey"), icon: "vial" },
  ];
  const a = auth ?? { type: allowInherit ? "inherit" : "none" };
  const set = (patch) => onChange({ ...a, ...patch });
  const f = (label, key, type) => (
    <Field label={label}><VarInput type={type} value={a[key] ?? ""} readOnly={readOnly} onChange={(v) => set({ [key]: v })} /></Field>
  );
  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <Field label={t("auth.type")}><Select options={TYPES.filter((x) => allowInherit || x.value !== "inherit")} value={a.type} disabled={readOnly} onChange={(type) => set({ type })} /></Field>
      {a.type === "bearer" && f(t("auth.token"), "token")}
      {a.type === "basic" && <>{f(t("auth.username"), "username")}{f(t("auth.password"), "password", "password")}</>}
      {a.type === "apikey" && (
        <>
          {f(t("auth.keyName"), "key")}
          {f(t("auth.value"), "value")}
          <Field label={t("auth.addTo")}><Select options={[{ value: "header", label: t("auth.inHeader") }, { value: "query", label: t("auth.inQuery") }]} value={a.in ?? "header"} disabled={readOnly} onChange={(v) => set({ in: v })} /></Field>
        </>
      )}
      <div className="muted">{t("auth.tip", { open: "{{", example: "{{token}}" })}</div>
    </div>
  );
}
