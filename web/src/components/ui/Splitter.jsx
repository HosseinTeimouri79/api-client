import { useRef } from "react";
import { cx } from "../../lib/utils.js";

/** Drag handle. `onDrag(delta)` receives pixels along the axis; keyboard arrows nudge by 16px. */
// In right-to-left layouts a horizontal drag towards the right makes the pane before the handle smaller, not larger.
const flip = () => (document.documentElement.dir === "rtl" ? -1 : 1);
export function Splitter({ dir = "col", onDrag, onEnd, className }) {
  const last = useRef(0);
  const down = (e) => {
    e.preventDefault();
    last.current = dir === "col" ? e.clientX : e.clientY;
    document.body.classList.add("resizing", `resizing-${dir}`); // not a bare `row`/`col`: .row is the flex utility class
    const move = (ev) => { const p = dir === "col" ? ev.clientX : ev.clientY; onDrag((p - last.current) * (dir === "col" ? flip() : 1)); last.current = p; };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); document.body.classList.remove("resizing", `resizing-${dir}`); onEnd?.(); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return (
    <div role="separator" aria-orientation={dir === "col" ? "vertical" : "horizontal"} tabIndex={0} className={cx("splitter", dir, className)} onPointerDown={down}
      onKeyDown={(e) => { const k = dir === "col" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"]; if (k.includes(e.key)) { e.preventDefault(); onDrag((e.key === k[0] ? -16 : 16) * (dir === "col" ? flip() : 1)); onEnd?.(); } }} />
  );
}
