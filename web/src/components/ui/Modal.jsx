import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../lib/utils.js";
import { IconButton } from "./Button.jsx";
import { modals } from "./modals.js";
import { useT } from "../../i18n/index.js";

export function ModalHost() {
  const list = useSyncExternalStore(modals.subscribe, modals.get);
  return list.map((m) => <Slot key={m.id} m={m} top={list.at(-1) === m} />);
}
const Slot = ({ m }) => m.render(m.close);

/** Frame used by every dialog. Esc closes the topmost one; backdrop click closes; focus returns to the opener. */
export function Modal({ title, onClose, size = "md", children, footer, icon }) {
  const t = useT();
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    (el.querySelector("[data-autofocus]") ?? el.querySelector("input:not([type=checkbox]),textarea,select,button.btn-primary") ?? el).focus?.(); // an explicit marker wins over document order
    const key = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".popover") && [...document.querySelectorAll(".modal")].at(-1) === el) onClose();
      if (e.key === "Tab") {
        const f = [...el.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,[href],[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent);
        if (!f.length) return;
        const first = f[0], last = f.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); prev?.focus?.(); };
  }, []);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx("modal", `modal-${size}`)} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className="modal-h">
          <h2>{title}</h2>
          <IconButton icon="xmark" label={t("common.close")} onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-f">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
