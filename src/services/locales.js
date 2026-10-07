// Interface languages. The UI (web/src/i18n) ships a dictionary for each; a test keeps both lists in step.
export const LOCALES = ["en-US", "es-ES", "zh-CN", "de-DE", "fr-FR", "ja-JP", "pt-BR", "ko-KR", "hi-IN", "it-IT", "id-ID", "tr-TR", "ar-SA", "ru-RU", "fa-IR"];
// Codes stored by older versions.
export const LEGACY = { en: "en-US", fa: "fa-IR" };
export const normalizeLocale = (l) => LEGACY[l] ?? l;
