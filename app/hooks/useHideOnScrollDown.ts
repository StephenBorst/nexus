// Hide a floating control while the reader scrolls down, bring it back on any scroll up or near the
// top. For the ◆ copilot orb on phones, where it otherwise sits on top of row buttons and numbers.
//
// Listens in the CAPTURE phase on document, so it also sees scrolls of inner scrollers (the Lab
// scrolls inside Orderly's .oui-scaffold-root, not the window). Vertical movement only: a sideways
// chip row changes scrollLeft, not scrollTop, and leaves the control alone.
import { useEffect, useRef, useState } from "react";

const MIN_STEP = 6;   // px of vertical movement before it counts as a direction
const NEAR_TOP = 48;  // px from the top of a scroller where the control always shows

export function useHideOnScrollDown(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);

  useEffect(() => {
    const set = (h: boolean) => { if (hiddenRef.current !== h) { hiddenRef.current = h; setHidden(h); } };
    if (!enabled) { set(false); return; }
    const last = new WeakMap<object, number>();
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement : e.target;
      if (!(el instanceof Element)) return;
      const top = el.scrollTop;
      const prev = last.get(el);
      last.set(el, top);
      if (top < NEAR_TOP) return set(false);
      if (prev === undefined) return;
      if (top - prev > MIN_STEP) set(true);
      else if (prev - top > MIN_STEP) set(false);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [enabled]);

  return hidden;
}
