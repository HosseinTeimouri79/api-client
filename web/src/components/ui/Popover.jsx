import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../lib/utils.js";

// Positions a floating panel next to an anchor (element or {x,y} point) and keeps it inside the viewport.
// Rendered in a portal so overflow:hidden parents and modals never clip it.
export function Popover({ anchor, open, onClose, matchWidth, placement = "bottom-start", className, children, maxHeight = 320, ignore }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const last = useRef(null); // { anchor, r }: last real geometry of the anchor

  const place = () => {
    const el = ref.current;
    if (!el || !anchor) return;
    const isPoint = !("getBoundingClientRect" in anchor);
    let r = isPoint ? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 } : anchor.getBoundingClientRect();
    // An anchor that is hidden (display:none once the pointer leaves its row) or unmounted measures as all zeros;
    // trusting that would fling the popover to the top-left corner, so keep using the last real position.
    if (!isPoint && (!anchor.isConnected || (r.width === 0 && r.height === 0))) r = last.current?.anchor === anchor ? last.current.r : r;
    else last.current = { anchor, r };
    const w = matchWidth ? r.width : undefined;
    const pw = w ?? el.offsetWidth,
      ph = Math.min(el.scrollHeight, maxHeight);
    const vw = innerWidth,
      vh = innerHeight;
    const below = vh - r.bottom,
      above = r.top;
    const up = placement.startsWith("top") || (below < ph + 8 && above > below);
    const left = placement.endsWith("end") ? r.right - pw : r.left;
    const next = {
      left: Math.round(Math.max(8, Math.min(left, vw - pw - 8))),
      top: Math.round(up ? Math.max(8, r.top - ph - 4) : r.bottom + 4),
      width: w && Math.round(w),
      maxHeight: Math.round(Math.max(120, Math.min(maxHeight, (up ? above : below) - 12))),
    };
    // children change identity every render: only update state when the geometry really changed (no render loop)
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.width === next.width && p.maxHeight === next.maxHeight ? p : next));
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open, anchor, children]);
  useEffect(() => {
    if (!open) return;
    const reflow = () => place();
    const down = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (anchor?.contains?.(e.target) || ignore?.contains?.(e.target)) return;
      onClose?.();
    };
    addEventListener("resize", reflow);
    addEventListener("scroll", reflow, true);
    document.addEventListener("mousedown", down);
    return () => {
      removeEventListener("resize", reflow);
      removeEventListener("scroll", reflow, true);
      document.removeEventListener("mousedown", down);
    };
  }, [open, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className={cx("popover", className)} style={{ ...pos, visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
