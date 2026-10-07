// App settings: defaults, font presets and applying them to the page. The server schema
// (src/services/userSettings.js) is the source of truth; a test keeps DEFAULT_SETTINGS in step with it.
export const DEFAULT_SETTINGS = {
  request: { timeoutMs: 30000, maxResponseMb: 10 },
  ui: { openConsole: false, layout: "stacked" },
  editor: { fontFamily: "", fontSize: 13, indentCount: 2, indentType: "space", autoCloseBrackets: true, autoCloseQuotes: true },
  app: { theme: "dark", fontFamily: "", autosave: false },
};
export const mergeSettings = (s) => Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, d]) => [k, { ...d, ...(s?.[k] ?? {}) }]));

// Installed fonts only: the app ships no font files, so each preset is a stack that falls back to what the system has.
export const APP_FONTS = [
  { value: "", label: "System default" },
  { value: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', label: "Segoe UI / Roboto" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial / Helvetica" },
  { value: "Tahoma, Verdana, sans-serif", label: "Tahoma / Verdana" },
  { value: 'Vazirmatn, Vazir, Tahoma, sans-serif', label: "Vazirmatn (if installed)" },
  { value: 'Georgia, "Times New Roman", serif', label: "Georgia (serif)" },
];
export const EDITOR_FONTS = [
  { value: "", label: "System monospace" },
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: '"Fira Code", monospace', label: "Fira Code" },
  { value: '"Cascadia Code", "Cascadia Mono", monospace', label: "Cascadia Code" },
  { value: 'Consolas, "Liberation Mono", monospace', label: "Consolas" },
  { value: 'Menlo, Monaco, monospace', label: "Menlo / Monaco" },
  { value: '"Courier New", Courier, monospace', label: "Courier New" },
];
export const CUSTOM = "__custom__";

/** One indentation step as typed into the editor. */
export const indentUnit = (e) => (e.indentType === "tab" ? "\t" : " ".repeat(e.indentCount));

/** Pushes settings into CSS variables (fonts, editor size, tab width) and the theme attribute. */
export function applySettingsToPage(s) {
  const root = document.documentElement;
  const set = (name, v) => (v ? root.style.setProperty(name, v) : root.style.removeProperty(name));
  set("--app-font", s.app.fontFamily);
  set("--editor-font", s.editor.fontFamily);
  root.style.setProperty("--editor-size", `${s.editor.fontSize}px`);
  root.style.setProperty("--indent-size", String(s.editor.indentCount)); // also the width of a Tab character
  root.dataset.theme = s.app.theme;
}
