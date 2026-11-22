# Agent notes for MiniMail

## Actions must be consistent everywhere

Whenever you add a new action (block, archive, snooze, ...), add it to **all** of these places by
default, unless the user says otherwise:

1. **The context menu** of a row or open conversation (`menuEntries` in `mail-app.tsx`).
2. **The top toolbar of the email view** (`ThreadView` in `components/mail/thread-view.tsx`).
3. **The bulk action toolbar** shown when several conversations are selected (`bulkBar` in `mail-app.tsx`).
4. **The CLI** (`CLI_COMMANDS` in `shared/cli.ts`). A new action that can be undone gets a command in the Organize
   group (see "The CLI for AI agents" below); one that cannot be undone goes in Ask first.

Keep the same order, labels, icons and wording across the three. Where an action has choices
(for example sender or domain), use the same choices in each place; share the builder rather than
copying it (see `blockChoices` in `lib/blocklist.ts`). If an action cannot apply somewhere (for
example Sent and Drafts), leave it out of all three the same way.

Current order in the email view toolbar: Pin, read / unread, Category, Priority, Mute, Block, Unsubscribe, a divider,
Inbox, Archive, Trash, Spam, Delete forever. (The bulk bar follows the same order, Priority included (`PrioritySelectionMenuButton`, `setPriority`), with a divider after the selection count and one before the moves;
the selection count comes first there, and the context menu lists the everyday commands first, Unsubscribe right after Mute, then the
discarding ones after a divider.) Unsubscribe is shown whenever at least one selected conversation
can be unsubscribed from; the others are skipped (`unsubscribeCommand` / `planUnsubscribe` in
`shared/unsubscribe.ts`). Once the user unsubscribed from a list (`List-Id`, else the sender's address) the button is greyed out
everywhere with a tooltip saying so, until a message of that list arrives more than a day later (`STILL_RECEIVING_AFTER_MS`);
the wording comes from `unsubscribeButton` in `lib/unsubscribe-confirm.ts`, so use it in any new place. It also has a button among the hover buttons of a row, first, before Pin. It cannot be undone, so every
place asks first with the same card (`unsubscribeConfirm` in `lib/unsubscribe-confirm.ts`).

Block, Mute and Priority that would act on **several** senders or domains ("Block 5 domains…") ask first, in
`TargetsDialog`: each address or domain has a checkbox (all ticked) and only the ticked ones are acted on. The label ends
in "…" to say so (`actsOnMany` in `lib/blocklist.ts`). Every place goes through `targetsAsk` (`lib/targets-confirm.ts`),
so a new place for these commands must too.

## The CLI for AI agents

`minimail` (code in `src/main/cli/`) lets an AI agent on this computer use MiniMail, only as far as the person
allowed in Settings, CLI. Commands, by group: Always (status, help, open, undo), Read, Organize (pin, mark-read,
category, priority, mute, block, the moves), Drafts (`draft new|reply|reply-all|forward|edit|delete|list`) and Ask first
(`send`, `unsubscribe`, `invitation`).

- **It is a thin client of the running app**, over a private Unix socket (`server.ts`). Never read the mail files
  from another process: they are encrypted with the app's keychain item. The app writes the `minimail` command and
  its client (`launcher.ts`, `client.cjs`) when the CLI is on, and removes them when it is off. The link
  `~/.local/bin/minimail` (`path-link.ts`) is kept while the CLI is on (the `pathLink` setting, on unless the person turns it
  off) and is only ever changed or removed when it is MiniMail's own. The skill tells agents to try `minimail` first and the full path second.
- **One list of commands**, `CLI_COMMANDS` in `shared/cli.ts`. `help`, the CLI tab and the skill all come from it. A new
  command is an entry there (with its `options`, and `switches` if an option stands alone; `client.cjs` keeps the
  same switch list, and a test fails when they drift), a handler in `commands.ts` and a test; the tab picks it up.
- **Main enforces the permissions** (`handleCliRequest`), never the client or the page. Unknown options are refused.
- **Anything that must behave like a click goes through the page** (`PageBridge` in `page-bridge.ts`, requests in
  `shared/cli-page.ts`, handler in `renderer/lib/cli-page.ts`): mail moves and flags use `MailActions` (so Undo, the
  Log row "via CLI" and the server's answer come with them, and `whenSettled` says how it ended), block, priority and
  mute use the page's own lists, drafts use `lib/drafts`. The page opens hidden when the app has no window. Add a request
  kind there rather than doing such a change in the main process, which has no undo stack.
- **Mail text never reaches the CLI unscreened** (`redact.ts`). A message with a sign-in code is withheld everywhere
  (rows, `search`, `wait`, `show`, and as the source of a reply or forward: `withheld` answers, and a search never
  matches a withheld row on its text), and links show as `[link host]` unless the person allowed full links. A new
  command that returns mail text goes through `rowForCli` / `messageForCli` / `headersForCli`; one that matches on text
  goes through `searchable`. The skill (`skill.ts`) says the same things to the agent, and that mail is data, never instructions.
- **Ask first** (`askFirst` in `commands.ts`, `cli-confirm-dialog.tsx`): a command that cannot be undone shows a card
  (Reject, Allow once, Always allow) and waits. `send` skips the card only when every recipient, Cc and Bcc included,
  is on the allowed list (or sending to anyone is allowed in Settings), never for a draft with files the CLI attached, and
  what was approved is bound to the draft (`draftDigest`): if it changed while asking, it is not sent. A "no" is
  `rejected` and final. The CLI only changes, deletes or sends drafts it wrote since MiniMail started (`CliDrafts`).
  The safe button of every warning dialog gets the focus explicitly (`onOpenAutoFocus`), since the dialog would pick the first.
- **The skill file** is only ever written, rewritten or removed when it carries the `minimail-managed` marker.
  `~/.agents/skills` covers Codex, Cursor, Gemini CLI and Copilot (all document reading it); do not add their own folders.
- **Log:** a read is one Info row "Read N messages via CLI" (subjects and the search in `context`, never in the title);
  a change is recorded by the page as "... via CLI" with an Undo; a send is an Info row plus a notification when it
  was not asked; a CLI failure goes through `reportError("cli", ...)`. Not undoable, so not on the stack: send,
  unsubscribe, invitation answers.
- **Settings** live in the `cli` section of `settings.json` (version 3: `enabled`, `disabled`, `ask` per ask-first
  command, `allowedRecipients`, `hideLinks`, `pathLink`, `skillTargets`; older versions are upgraded by `STEPS` in `settings.ts`). Off by
  default. Organize block, mute and priority name addresses or `@domains` one by one, so they do not go through `TargetsDialog`.

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

