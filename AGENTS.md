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

## Undo

Every user action that can be taken back is on the undo stack (`src/renderer/src/lib/undo-stack.ts`):
⌘Z takes back the newest one, and the Log row of the action shows an Undo button (top right).
When you add an action, record it with `recordAction(..., { ref })` and push an entry with the same
`ref` from `newUndoRef(kind)`; `run` does the opposite *without* pushing again (no redo). Mail
moves and flags go through `MailActions` (`revert`, `inverseOf`), which also cancels a move still in
its 6-second window. `undoStack.group` folds follow-up actions into one entry (blocking, which also
moves mail to the Trash). Not undoable, so leave them out: sending, unsubscribing, deleting forever.
The stack is in memory: after a restart old Log rows have no Undo (refs carry a per-launch tag).

## Files on the user's computer: change the format, write the migration

Whenever a change alters what is stored on the user's computer (the mail cache, categories,
drafts, settings, the event journal, any file under userData), ship a migration **in the same
change**, with a test that feeds it a file in the old format. No exceptions, and no "bump the
version and let it rebuild": a version the code does not recognise is never a reason to throw
data away.

- Keep each file's `version`, and upgrade older versions step by step (v1 to v2 to v3) when it is read.
- Fill new fields from what is already on disk. If something truly cannot be derived locally
  (a header never downloaded), keep the row, mark the field as unknown and fetch only that in the background.
- Whenever the app does have to download mail again (a new folder, a changed server numbering),
  the person must see it: reuse the sorting indicator (spinner in the rail, with a count) and never
  show an empty list as if the mail were gone.
- The one allowed discard is a file that is corrupt or cannot be decrypted; it is reported (`reportError`)
  and the rebuild shows the same indicator.

## Nothing fails silently

Every failure, whatever it is, must reach **both** `main.log` and the Log popover. There
is one way to do it: the event journal (`src/main/event-journal.ts`). Never use `console.error`, a
bare `catch {}`, or a direct `import { toast } from "sonner"`; `src/failures-recorded.test.ts` fails
the build on all three.

- **Main process:** `reportError(area, title, cause, { context, accountId })` from `src/main/events.ts`.
  `recordAction` / `recordInfo` log what the user or the app did. The IPC wrapper in `ipc.ts` already
  records any handler that throws, so a failure that propagates to the page needs nothing more (code
  that reports and then rethrows is not recorded twice, see `wasReported`).
- **Renderer:** `reportError` / `recordAction` from `lib/events.ts`; import `toast` from `@/lib/toast`
  (an error toast is recorded too); show an inline error with `noteShownError`. Both skip a failure
  the main process already recorded.
- **A catch that is not a failure** (a missing logo, a value that is not a URL, a request main already
  recorded) must say why in a comment starting with `expected:`.
- **Private text** (sender, subject) goes in `context`, never in `title` or `detail`: `context` is
  encrypted on disk and kept out of `main.log`.
- **Cheap and non-blocking:** recording only touches memory; encrypting, writing and telling the page
  happen later, in batches. Keep it that way: no synchronous file or keychain work on a caller's turn.
- **New user actions** are recorded too (see the list under "Actions must be consistent everywhere"):
  one `recordAction` per action, with the subjects as `context`.

