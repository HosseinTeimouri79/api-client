// The interface languages: native name, flag (see components/ui/Flag.jsx) and text direction.
// Keep in step with src/services/locales.js (a test compares the two).
export const LOCALES = [
  { id: "en-US", label: "English", flag: "us", dir: "ltr" },
  { id: "es-ES", label: "Español", flag: "es", dir: "ltr" },
  { id: "zh-CN", label: "简体中文", flag: "cn", dir: "ltr" },
  { id: "de-DE", label: "Deutsch", flag: "de", dir: "ltr" },
  { id: "fr-FR", label: "Français", flag: "fr", dir: "ltr" },
  { id: "ja-JP", label: "日本語", flag: "jp", dir: "ltr" },
  { id: "pt-BR", label: "Português (Brasil)", flag: "br", dir: "ltr" },
  { id: "ko-KR", label: "한국어", flag: "kr", dir: "ltr" },
  { id: "hi-IN", label: "हिन्दी", flag: "in", dir: "ltr" },
  { id: "it-IT", label: "Italiano", flag: "it", dir: "ltr" },
  { id: "id-ID", label: "Bahasa Indonesia", flag: "id", dir: "ltr" },
  { id: "tr-TR", label: "Türkçe", flag: "tr", dir: "ltr" },
  { id: "ar-SA", label: "العربية", flag: "sa", dir: "rtl" },
  { id: "ru-RU", label: "Русский", flag: "ru", dir: "ltr" },
  { id: "fa-IR", label: "فارسی", flag: "ir", dir: "rtl" },
];
export const DEFAULT_LOCALE = "en-US";
export const LEGACY = { en: "en-US", fa: "fa-IR" }; // codes stored by older versions
export const normalizeLocale = (id) => LEGACY[id] ?? id;
/** Best match for a browser language such as "pt", "es-MX" or "zh-Hans-CN". */
export function matchLocale(tag) {
  const t = String(tag ?? "").toLowerCase();
  return LOCALES.find((l) => l.id.toLowerCase() === t)?.id ?? LOCALES.find((l) => l.id.slice(0, 2).toLowerCase() === t.slice(0, 2))?.id ?? null;
}
