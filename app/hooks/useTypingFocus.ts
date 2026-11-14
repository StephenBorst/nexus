// True while a text field has focus (rule: app/lib/typingTarget.mjs). Used to step the ◆ copilot orb
// aside on phones, where the keyboard would otherwise park it on the field being typed in.
import { useEffect, useState } from "react";
import { isTypingTarget } from "@/lib/typingTarget.mjs";

export function useTypingFocus(enabled: boolean): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!enabled) { setTyping(false); return; }
    const sync = () => setTyping(isTypingTarget(document.activeElement));
    // focusout fires before the next element takes focus: read activeElement on the next frame.
    const onOut = () => requestAnimationFrame(sync);
    document.addEventListener("focusin", sync, true);
    document.addEventListener("focusout", onOut, true);
    sync();
    return () => { document.removeEventListener("focusin", sync, true); document.removeEventListener("focusout", onOut, true); };
  }, [enabled]);
  return typing;
}
