import { create } from "zustand";
import enUS from "./locales/en-US.js";
import { LOCALES, DEFAULT_LOCALE, normalizeLocale, matchLocale } from "./locales.js";

export { LOCALES, DEFAULT_LOCALE };
// Flat keys, `{name}` placeholders, English fallback. Dictionaries load on demand, one chunk per language.
// Add a language: a file in ./locales, an entry in ./locales.js and in src/services/locales.js.
const loaders = import.meta.glob(["./locales/*.js", "!./locales/en-US.js"]);
const DICT = { [DEFAULT_LOCALE]: enUS };
const read = () => { try { return localStorage.getItem("locale"); } catch { return null; } };

export const useI18n = create(() => ({ locale: DEFAULT_LOCALE }));

async function load(id) {
  if (DICT[id]) return;
  try { DICT[id] = (await loaders[`./locales/${id}.js`]()).default; } catch { /* keep the fallback */ }
}
export const initialLocale = () => {
  const saved = normalizeLocale(read());
  if (LOCALES.some((l) => l.id === saved)) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) { const m = matchLocale(tag); if (m) return m; }
  return DEFAULT_LOCALE;
};
/** Loads a language, sets <html lang dir> (the whole page follows the direction) and remembers the choice. */
export async function applyLocale(id) {
  const l = LOCALES.find((x) => x.id === normalizeLocale(id)) ?? LOCALES[0];
  await load(l.id);
  try { localStorage.setItem("locale", l.id); } catch { /* private mode */ }
  document.documentElement.lang = l.id;
  document.documentElement.dir = l.dir;
  useI18n.setState({ locale: l.id });
}
/** Called once before the first render. */
export const initI18n = () => applyLocale(initialLocale());
export const isRtl = () => document.documentElement.dir === "rtl";

export function translate(locale, key, vars) {
  const s = DICT[locale]?.[key] ?? enUS[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
/** For code outside React (toasts, store actions). */
export const t = (key, vars) => translate(useI18n.getState().locale, key, vars);
/** In components: re-renders when the language changes. */
export function useT() {
  const locale = useI18n((s) => s.locale);
  return (key, vars) => translate(locale, key, vars);
}
