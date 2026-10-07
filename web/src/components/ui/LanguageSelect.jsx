import { LOCALES, applyLocale, useI18n, useT } from "../../i18n/index.js";
import { useStore } from "../../store.js";
import { Flag } from "./Flag.jsx";
import { Select } from "./Select.jsx";

const OPTIONS = LOCALES.map((l) => ({ value: l.id, label: l.label, flag: l.flag, search: `${l.label} ${l.id}` }));
const row = (o) => <><Flag code={o.flag} /><span className="lang-name">{o.label}</span></>;

/** Language picker: flag + native name. Signed-in users also save the choice to their account. */
export function LanguageSelect({ className, size, compact }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const change = (id) => (useStore.getState().user ? useStore.getState().setLocale(id) : applyLocale(id));
  return (
    <Select className={className} size={size} aria-label={t("common.language")} title={t("common.language")} value={locale} options={OPTIONS} searchable onChange={change}
      renderValue={(o) => <span className={compact ? "lang-val compact" : "lang-val"}>{row(o)}</span>}
      renderOption={(o) => <span className="lang-opt">{row(o)}</span>} />
  );
}
