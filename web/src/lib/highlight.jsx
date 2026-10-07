import { Fragment } from "react";
import { escapeRe } from "./utils.js";

const mark = (s, q, cls, key) => {
  if (!q || !s.toLowerCase().includes(q.toLowerCase())) return cls ? <span key={key} className={cls}>{s}</span> : <Fragment key={key}>{s}</Fragment>;
  return (
    <span key={key} className={cls}>
      {s.split(new RegExp(`(${escapeRe(q)})`, "ig")).map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p))}
    </span>
  );
};
const JSON_RE = /("(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
export function highlightJson(text, q = "") {
  const out = [];
  let last = 0, m, i = 0;
  JSON_RE.lastIndex = 0;
  while ((m = JSON_RE.exec(text))) {
    if (m.index > last) out.push(mark(text.slice(last, m.index), q, "", i++));
    const t = m[0];
    out.push(mark(t, q, t.startsWith('"') ? (m[2] ? "j-key" : "j-str") : /true|false/.test(t) ? "j-bool" : t === "null" ? "j-null" : "j-num", i++));
    last = JSON_RE.lastIndex;
  }
  if (last < text.length) out.push(mark(text.slice(last), q, "", i++));
  return out;
}
const JS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|\b(const|let|var|function|return|if|else|for|while|of|in|new|try|catch|throw|typeof|async|await|true|false|null|undefined|break|continue)\b|\b(pm|postman|CryptoJS|console|response|test|expect|require|btoa|atob|JSON|Date|Math|Object|Array)\b/g;
export function highlightJs(text) {
  const out = [];
  let last = 0, m, i = 0;
  JS_RE.lastIndex = 0;
  while ((m = JS_RE.exec(text))) {
    if (m.index > last) out.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    const cls = m[1] ? "c-com" : m[2] ? "j-str" : m[3] ? "j-num" : m[4] ? "c-kw" : "c-bi";
    out.push(<span key={i++} className={cls}>{m[0]}</span>);
    last = JS_RE.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return out;
}
export const highlightText = (text, q) => (q ? [mark(text, q, "", 0)] : text);
