/** True when the keystroke is going into a text field, where shortcuts must stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
  );
}
