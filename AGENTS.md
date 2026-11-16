# Agent notes for MiniMail

## Actions must be consistent everywhere

Whenever you add a new action (block, archive, snooze, ...), add it to **all** of these places by
default, unless the user says otherwise:

1. **The context menu** of a row or open conversation (`menuEntries` in `mail-app.tsx`).
2. **The top toolbar of the email view** (`ThreadView` in `components/mail/thread-view.tsx`).
3. **The bulk action toolbar** shown when several conversations are selected (`bulkBar` in `mail-app.tsx`).

Keep the same order, labels, icons and wording across the three. Where an action has choices
(for example sender or domain), use the same choices in each place; share the builder rather than
copying it (see `blockChoices` in `lib/blocklist.ts`). If an action cannot apply somewhere (for
example Sent and Drafts), leave it out of all three the same way.

Current order in the email view toolbar: Pin, read / unread, Category, Priority, Mute, Block, Unsubscribe, a divider,
Inbox, Archive, Trash, Spam, Delete forever. (The bulk bar has no Priority and follows the same order, with a divider after the selection count and one before the moves;
the selection count comes first there, and the context menu lists the everyday commands first, Unsubscribe right after Mute, then the
discarding ones after a divider.) Unsubscribe is shown whenever at least one selected conversation
can be unsubscribed from; the others are skipped (`unsubscribeCommand` / `planUnsubscribe` in
`shared/unsubscribe.ts`). Once the user unsubscribed from a list (`List-Id`, else the sender's address) the button is greyed out
everywhere with a tooltip saying so, until a message of that list arrives more than a day later (`STILL_RECEIVING_AFTER_MS`);
the wording comes from `unsubscribeButton` in `lib/unsubscribe-confirm.ts`, so use it in any new place. It also has a button among the hover buttons of a row, first, before Pin. It cannot be undone, so every
place asks first with the same card (`unsubscribeConfirm` in `lib/unsubscribe-confirm.ts`).
