import { toast } from "../components/ui/Toasts.jsx";
import { t } from "../i18n/index.js";

/**
 * Put text on the clipboard. `navigator.clipboard` exists only in secure contexts (HTTPS or localhost),
 * so a self-hosted instance opened over plain HTTP by IP/hostname falls back to a hidden textarea + execCommand.
 */
export async function copyText(text) {
  text = String(text ?? "");
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* permission denied / not focused: try the fallback */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  // Inside a modal, keep the textarea in the dialog so its focus trap does not fight the selection.
  const host = document.activeElement?.closest?.("[role=dialog]") ?? document.body;
  const prev = document.activeElement;
  host.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  prev?.focus?.({ preventScroll: true });
  if (!ok) throw new Error("copy failed");
}

/** Copy and report the outcome with a toast. */
export const copy = (text) =>
  copyText(text).then(() => toast(t("common.copied"), "ok"), () => toast(t("common.copyFailed"), "error"));
