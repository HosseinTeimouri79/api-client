import { useSyncExternalStore } from "react";
import { Icon } from "./Icon.jsx";

let items = [], seq = 0;
const subs = new Set();
const emit = () => subs.forEach((f) => f());
export function toast(message, kind = "info") {
  const t = { id: ++seq, message, kind };
  items = [...items, t].slice(-5);
  emit();
  setTimeout(() => { items = items.filter((x) => x !== t); emit(); }, kind === "error" ? 6000 : 3500);
}
const ICONS = { ok: "circle-check", error: "circle-exclamation", info: "circle-info" };
export function Toasts() {
  const list = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => items);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}><Icon name={ICONS[t.kind] ?? ICONS.info} /><span>{t.message}</span></div>
      ))}
    </div>
  );
}
