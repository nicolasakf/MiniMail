import type { UnsubscribeCommand } from "@shared/unsubscribe";

/**
 * The wording of the card that asks before unsubscribing. A sender that has been told to drop the
 * user from its list cannot be called back, so every Unsubscribe button asks first.
 */
export function unsubscribeConfirm(senders: number) {
  return {
    title: senders > 1 ? `Unsubscribe from ${senders} lists?` : "Unsubscribe?",
    description: "The sender is asked to remove you from its list. You can't undo this.",
    confirmLabel: "Unsubscribe",
    // Nothing is deleted here, so the confirm button is not red like "Delete forever".
    confirmVariant: "default" as const,
  };
}

/**
 * What every Unsubscribe button says, and whether it can be pressed: greyed out once the user
 * unsubscribed from the list, with the date; back to normal (with a hint) when the list keeps sending.
 * `many` is for a selection of conversations rather than one.
 */
export function unsubscribeButton(command: UnsubscribeCommand, many: boolean): { label: string; disabled: boolean } {
  if (command.enabled) {
    return { label: command.again ? "Still receiving mail from this list. Unsubscribe again?" : "Unsubscribe", disabled: false };
  }
  const when =
    command.doneAt === null
      ? ""
      : ` on ${new Date(command.doneAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return {
    label: many ? "You have already unsubscribed from these lists." : `You unsubscribed from this list${when}.`,
    disabled: true,
  };
}
