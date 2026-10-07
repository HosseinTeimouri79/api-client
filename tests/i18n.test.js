// i18n: every language ships the same keys, placeholders and untranslated product names; no key is missing from the
// source, no key is dead, and no UI text is hard-coded in the components.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LOCALES as SERVER_LOCALES } from "../src/services/locales.js";
import { LOCALES, DEFAULT_LOCALE, matchLocale, normalizeLocale } from "../web/src/i18n/locales.js";

const SRC = new URL("../web/src/", import.meta.url).pathname;
const en = (await import("../web/src/i18n/locales/en-US.js")).default;
const dicts = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l.id, (await import(`../web/src/i18n/locales/${l.id}.js`)).default])));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const sources = walk(SRC).filter((f) => /\.jsx?$/.test(f) && !f.includes("/i18n/")).map((f) => [path.relative(SRC, f), fs.readFileSync(f, "utf8")]);
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("the language list: 15 languages, matching the server, RTL only for Arabic and Persian", () => {
  assert.deepEqual(LOCALES.map((l) => l.id), ["en-US", "es-ES", "zh-CN", "de-DE", "fr-FR", "ja-JP", "pt-BR", "ko-KR", "hi-IN", "it-IT", "id-ID", "tr-TR", "ar-SA", "ru-RU", "fa-IR"]);
  assert.deepEqual(LOCALES.map((l) => l.id), SERVER_LOCALES);
  assert.deepEqual(LOCALES.filter((l) => l.dir === "rtl").map((l) => l.id), ["ar-SA", "fa-IR"]);
  assert.ok(LOCALES.filter((l) => l.dir !== "rtl").every((l) => l.dir === "ltr"));
  assert.equal(DEFAULT_LOCALE, "en-US");
  assert.equal(new Set(LOCALES.map((l) => l.label)).size, 15);
  // old short codes and browser tags resolve to a supported language
  assert.equal(normalizeLocale("fa"), "fa-IR");
  assert.equal(normalizeLocale("en"), "en-US");
  assert.deepEqual(["pt", "es-MX", "zh-Hans-CN", "ar", "fa", "xx"].map(matchLocale), ["pt-BR", "es-ES", "zh-CN", "ar-SA", "fa-IR", null]);
});

test("every language has a flag", () => {
  const flags = fs.readFileSync(path.join(SRC, "components/ui/Flag.jsx"), "utf8");
  const drawn = new Set([...flags.matchAll(/^  (\w+): <>/gm)].map((m) => m[1]));
  for (const l of LOCALES) assert.ok(drawn.has(l.flag), `no flag drawn for ${l.id} (${l.flag})`);
});

for (const l of LOCALES.filter((x) => x.id !== "en-US"))
  test(`dictionary ${l.id}: same keys and placeholders as en-US, nothing left empty`, () => {
    const d = dicts[l.id];
    assert.deepEqual(Object.keys(d).filter((k) => !(k in en)), [], "keys that don't exist in en-US");
    assert.deepEqual(Object.keys(en).filter((k) => !(k in d)), [], "keys missing");
    for (const [k, v] of Object.entries(en)) {
      assert.equal(typeof d[k], "string", k);
      assert.ok(d[k].trim().length > 0, `${k} is empty`);
      assert.equal(ph(d[k]), ph(v), `placeholders of ${k}: ${v}  vs  ${d[k]}`);
    }
  });

test("product and format names are never translated", () => {
  const names = ["Postman", "Hoppscotch", "API Client", "JSON", "PNG", "JPEG", "WebP", "ISC", "Bearer", "Basic"];
  for (const l of LOCALES.filter((x) => x.id !== "en-US"))
    for (const [k, v] of Object.entries(en))
      for (const n of names) if (v.includes(n)) assert.ok(dicts[l.id][k].includes(n), `${l.id} ${k} must keep "${n}": ${dicts[l.id][k]}`);
});

test("every t('key') in the source exists, and every key is used", () => {
  const used = new Set(), literals = new Set();
  for (const [, s] of sources) {
    for (const m of s.matchAll(/\b(?:t|tr)\(\s*["`]([\w.${}]+)["`]/g)) used.add(m[1]);
    for (const m of s.matchAll(/["'`]([a-z][A-Za-z]*(?:\.[A-Za-z0-9]+)+)["'`]/g)) literals.add(m[1]);
  }
  const dynamic = ["role.", "vars.scope."]; // keys built at runtime, e.g. t(`role.${r}`)
  const missing = [...used].filter((k) => !k.includes("$") && !k.endsWith(".") && !(k in en));
  assert.deepEqual(missing, [], "keys used in the source but absent from en-US");
  const dead = Object.keys(en).filter((k) => !literals.has(k) && !dynamic.some((p) => k.startsWith(p)));
  assert.deepEqual(dead, [], "keys no component uses");
});

test("no UI text is hard-coded in the components", () => {
  const allowed = new Set(["Ctrl", "Enter", "API Client", "JSON", "Postman", "Hoppscotch", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "Ctrl+S", "Ctrl+Enter", "OK", "Raw", "pm.test(...)", "console.log", "Tab", "Esc", "Basic", "Bearer", "API", "ISC", "cURL"]);
  const found = [];
  for (const [file, src] of sources) {
    if (/lib\/(snippets|http|highlight|image|settings)\.js|lib\/codegen|\.test\./.test(file)) continue; // data and code, not UI chrome
    const text = [...src.matchAll(/>\s*([A-Za-z][A-Za-z .,'!?…:-]{2,}?)\s*<\//g)].map((m) => m[1].trim()); // <b>Text</b>
    const attrs = [...src.matchAll(/\b(?:title|placeholder|aria-label|label|alt)="([A-Za-z][^"{]{2,})"/g)].map((m) => m[1]);
    for (const s of [...text, ...attrs]) if (!allowed.has(s)) found.push(`${file}: ${s}`);
  }
  assert.deepEqual(found, [], "hard-coded UI text (move it to the dictionaries)");
});
