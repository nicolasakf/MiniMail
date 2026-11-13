import { useEffect, useState } from "react";

/** How long ⌘ (Ctrl) must be held before the shortcut hints appear, so quick chords like ⌘C don't flash them. */
const HOLD_DELAY_MS = 350;

/**
 * True while the platform's command key (⌘ on a Mac, Ctrl elsewhere) has been held alone for a
 * moment. Releasing it, pressing any other key with it, or leaving the window hides the hints.
 */
export function useShortcutHints(isMac: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const modifier = isMac ? "Meta" : "Control";

    const hide = () => {
      clearTimeout(timer);
      timer = undefined;
      setVisible(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === modifier) {
        if (!event.repeat && timer === undefined) {
          timer = setTimeout(() => setVisible(true), HOLD_DELAY_MS);
        }
        return;
      }
      // Another key joined the chord: the shortcut is in use, not being looked up.
      hide();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === modifier || !(isMac ? event.metaKey : event.ctrlKey)) hide();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", hide);
    };
  }, [isMac]);

  return visible;
}
