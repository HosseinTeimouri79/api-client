import { create } from "zustand";
import { en } from "./en.js";
import { fa } from "./fa.js";

// Tiny i18n: flat keys, `{name}` placeholders, English fallback. Add a language = add a dictionary + an entry here.
export const LOCALES = [
  { id: "en", label: "English", dir: "ltr" },
  { id: "fa", label: "فارسی", dir: "rtl" },
];
const DICT = { en, fa };
const read = () => { try { return localStorage.getItem("locale"); } catch { return null; } };
const initial = () => {
  const saved = read();
  if (LOCALES.some((l) => l.id === saved)) return saved;
  return navigator.language?.toLowerCase().startsWith("fa") ? "fa" : "en";
};

export const useI18n = create(() => ({ locale: initial() }));

/** Applies direction/lang to <html> and remembers the choice for the sign-in screen. */
export function applyLocale(id) {
  const l = LOCALES.find((x) => x.id === id) ?? LOCALES[0];
  try { localStorage.setItem("locale", l.id); } catch { /* private mode */ }
  document.documentElement.lang = l.id;
  document.documentElement.dir = l.dir;
  useI18n.setState({ locale: l.id });
}

export function translate(locale, key, vars) {
  const s = DICT[locale]?.[key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
/** For code outside React (toasts, store actions). */
export const t = (key, vars) => translate(useI18n.getState().locale, key, vars);
/** In components: re-renders when the language changes. */
export function useT() {
  const locale = useI18n((s) => s.locale);
  return (key, vars) => translate(locale, key, vars);
}
