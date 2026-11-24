# MiniMail guide

The [README](../README.md) has the short version. This is everything else.

MiniMail brings Gmail, Outlook (personal and work/school), Zoho Mail, and other IMAP accounts into one inbox.
Use categories to group conversations by what the mail is about, or browse by sender or date.

MiniMail uses Electron, React, Tailwind CSS and Radix UI. It reads mail straight from your providers
(IMAP/SMTP for Gmail and other mail providers, Microsoft Graph for Outlook). There is no server; credentials
are encrypted with the OS keychain and never leave this computer.

## Run it

```bash
npm install --legacy-peer-deps
npm run dev          # Electron app with hot reload
npm run dev:web      # UI only, in a browser, with demo data (no accounts needed)
npm run build        # production build into out/
npm test             # unit tests
npm run typecheck
```

`npm run dev:web` is the quickest way to see the interface: it runs the renderer against an
in-memory demo backend (three fictional accounts) instead of Electron. Two switches in the URL
show the states a slow mail server produces: `?slow=8000` delays opening a message by 8 s, and
`?getfail=2` makes the first two opens fail (then "Try again" works). `?onboarding` starts like a
fresh install (no account), so the first-run setup guide opens.

## What it does

- **Smart view** in the inbox: mail from people as individual conversations, with Notifications, Newsletters,
  Invitations, Invitation responses and Pinned collapsed into one row each, with sender chips.
  Click a group to open its own list (Back or Esc returns). Hover a group to archive all of it.
- Date sections you can fold (Today, Yesterday, This Week, Last Week, then months, then years), conversation threading with a
  message count, unread dots, colored sender rings, one dot per account in the unified view.
- Folders: Inbox, Pinned, Drafts, Sent. Archive, Trash and Spam are not in the sidebar: the Inbox header has an unread-only button and, beside it, a group that checks which folders the list shows (Inbox, Archive, Trash, Spam; only Inbox is checked by default, and the choice is remembered). Archive, Trash and Spam rows are marked with a gray, red or amber icon beside the sender. The dropdown next to the title
  shows which account is in view ("All accounts" or the account's alias or address) and
  switches it.
- **Account aliases**: give an account a short name (for example "Work") when you add it, or
  later with the pencil in **Manage accounts**. It replaces the address in the switcher, the
  account menu, the From picker and the conversation header, with the address kept underneath
  where there is room. Only MiniMail shows it: it is never sent in mail or to the provider.
  Leave it blank to go back to the address.
- **Views**, switched with the tabs next to the account dropdown: **Smart** (the default,
  with categories), **Sender** and **List** (by date). Tab cycles through the
  tabs, Shift+Tab goes back. Sender adds a panel next to
  the rail with every address the folder has mail from; pick one to list its mail, or group the
  panel by domain and expand a domain to see its senders. Opening a conversation there keeps
  the panel and replaces only the list.
- **Categories you define**, sorted by AI. See the next section.
- Conversation view, reply / reply all / forward, compose with account picker. The composer floats
  over the mail instead of blocking it, so you can keep reading while you write; Esc closes it and
  keeps a draft. Select text to show the formatting toolbar, or use the formatting button to keep
  it open. The editor supports text styles, colors, fonts, links, lists, quotes, tables, and inline
  images. Use the footer menu to insert an account signature, or to write one in the same editor
  (or as HTML, which is sanitized when saved). Signatures and drafts are stored locally with OS
  encryption. Minimize a draft to keep browsing the inbox, or open it in a separate desktop window.
  Send minimizes the message while it goes out; if the send fails, its pill turns red with a "!"
  and a toast offers to reopen it.
  Send Later (the arrow beside Send) queues mail in Drafts and sends when MiniMail is running.
- Select mode (the pill switch) for bulk actions, search (loaded mail), light/dark/system theme.
- Search filters: type `/` in the search box for the fields (`from:`, `to:`, `subject:`, `has:attachment`,
  `is:` unread / read / pinned / replied / priority, `in:` folder, `category:`, `account:`, `after:` and
  `before:` with a date or today / yesterday / week / month / year). Pick one with ↵ or Tab, then its value
  (people come from your contacts). A finished filter, with a space after it, becomes a chip: click it, or
  press Backspace in the empty box, to edit it as text again; × removes it. Use several at once: different
  fields must all match, the same field twice or a comma (`from:alice,bob`) means either, and plain words
  still match anywhere (`invoice from:alice is:unread`). `from: alice` works like `from:alice`. Quotes keep
  spaces and commas together (`subject:"weekly report"`). Esc closes the list first, then the search.
  `from:` and `to:` suggest your own signed-in accounts first, then your contacts; the list grows wider to fit
  a name and address, and puts the address under the name when they still do not fit.
  While you search the Inbox list, the Archive, Trash and Spam buttons that are off show a small number:
  the conversations in that folder that match (from the copy saved on this computer). Click one to show them.
- HTML mail is sanitized and shown in a sandboxed frame; remote images are blocked until you
  click "Load images".
  Clicking it also **trusts that sender**: next time their images load without asking, with a
  small note and a "Stop trusting" button above the message. Trust is per address (not the whole
  domain) and only applies while the mail server verifies the message really came from that
  address (the same DMARC/DKIM check logos use); an unverified message, such as a forgery of a
  trusted sender, keeps its images blocked and says why. Only a verified message can add a
  sender. The list is `trusted-senders.json` in the app's data folder, encrypted with the OS
  keychain. Loading a trusted sender's images tells them when you open their mail, which is the
  trade you are choosing.

Shortcuts: `↑ ↓` or `J K` move, `Enter` opens, `Esc` goes back, `E` done (archive),
`#` / `Delete` trash, `P` pin, `U` read/unread, `X` select, `C` compose, `⌘K` search, `⌘F` finds words in the open conversation (`↵` / `⇧↵` or `⌘G` / `⇧⌘G` step through the matches, `Esc` closes), `⌘U` toggles the unread-only filter, `⌘⇧U` marks everything the list shows as read, `/` opens the menu of the selected item (also on right-click; type to filter its commands), `⌘Z` undoes the last archive / trash / spam / delete, `⌘↵` send.

**Startup speed.** Each account loads on its own, so a slow server never holds back the others,
and MiniMail keeps a copy of the last list it saw (sender, subject, a short preview) so the
inbox appears as the window opens and is then refreshed in the background. First launch with
a new account still has to download its previews once; that is slow on some servers (Zoho took
about 35 s for 46 messages in testing) and fast on others. The copy is `mail-cache.json` in
the app's data folder, encrypted with the OS keychain like your passwords, dropped when you
remove the account, and discarded if the server renumbers its mailbox.

**Opening a message.** The conversation shows its senders, dates and the saved preview text at
once, then the full text as it arrives; if the server is slow it says so, and after a minute
it offers "Try again" (the download keeps going behind it). A refresh downloads previews in
small batches, sized to the server's speed, and lets message opens in between, so a slow
server (Zoho took 3 to 5 s per message in testing) delays an open by seconds, not by the whole
refresh. A conversation is fetched in one command and recently opened messages are kept in
memory, so reopening is instant. In dev builds the
terminal prints `[perf]` lines with timings (counts and durations only, no addresses or
content); set `MINIMAIL_PERF=1` to get them elsewhere.

Not built yet (by design): AI chat, calendar, snooze, attachments download, drafts autosave,
undo, push notifications (it polls every 60 s and on window focus).

## Categories and AI sorting

Categories group conversations in the inbox’s **Smart** view. MiniMail starts with
Invitations, Newsletters, Ads, Notifications and Verification codes. Newsletters are strictly
editorial (news, digests, reading); anything that sells, or announces the sender's own products,
features or offers, is an Ad even when it reads like news. An existing install gets Ads added
once on upgrade (delete it and it stays deleted). Open **Manage categories**
(the sliders button in the header) to rewrite their criteria, rename or delete them, or add your own. Every
category needs criteria: that text is what the classifier reads.
Each category also has an icon, chosen from every Lucide icon (about 2,000): click the icon beside
its name and search by any part of the name ("receipt", "cal plus"). A category without one
shows a tag.

How a message gets its category:

1. **A new conversation** (not a reply to one MiniMail already knows) is sent to **Jev**,
   TypeSafe AI's System One model, through the **Vercel AI Gateway** (`typesafe-ai/jev`),
   **OpenRouter** (`typesafe/jev-1.13`) or **TypeSafe's own API** (`jev-latest`), whichever you
   chose. Jev answers one multiple-choice question over your categories plus "None of these", and the
   answer is stored for the conversation.
2. **Replies** inherit the category of their conversation; they never cost another call.
3. Below 40% confidence, or "None of these", the conversation stays a normal row.
4. Until Jev answers, or with no key, a built-in guess from the mail headers (calendar invite,
   bulk-mail headers, automated sender) files mail under the matching built-in category.

To turn AI sorting on, open **Categories**, pick a provider (the Vercel AI Gateway, OpenRouter
or the TypeSafe API), create an API key with it, paste it and save. Each provider keeps its own
key, so you can switch between them under **Advanced** without pasting a key twice; switching
puts that provider's default model in place. Keys are stored encrypted with your system keychain, and
**Test connection** makes one real call so a bad key shows up immediately. New mail in all four
folders (Inbox, Archive, Spam and Trash) is classified by default, a few at a time; **Sort new mail in**
turns folders off (an install that was sorting before this default changed keeps sorting only the Inbox). After a failure MiniMail pauses its calls for a while instead
of retrying in a loop.

What leaves your computer: for each new conversation, the sender, the subject and about 500
characters of the body, to the provider you chose. Digit runs (codes) and the path and query of every link (magic-link
tokens) are replaced with placeholders first. Nothing is sent without a key.

Saving categories never re-sorts mail on its own. When you added a category, deleted one or
rewrote the criteria of one (renaming, icons, colors and order do not count) and an AI key is set,
Save first asks **Sort your mail again?** with three choices: **Cancel** (back to editing, nothing
saved), **Save and sort again…** (saves, then opens the **Sort mail again** menu so you choose how
far back and which folders), and **Save without sorting**. After a deletion the second choice reads
**Save, no category for its mail**: the conversations that were in the deleted category are filed
under no category and nothing is sent to the model. Without a key, a deleted category's mail goes
back to the built-in guess from the mail headers.
**Sort mail again** is also always available next to the category list.
A toast follows the run ("5 of 40" with a bar) and ends with how many conversations were sorted, or
why it stopped. The total is what has been queued so far, so it can grow as each account's inbox loads.

"Replied" comes from the mailbox: IMAP's `\Answered` flag (MiniMail sets it when you reply from
here) and, for Outlook, the last-verb property Outlook writes when you reply. Replies and
forwards from an Outlook account go out through Outlook's own reply draft, so they stay in the
conversation in every Outlook client and the original is marked as replied there too.

## Text completion

While you write, a model can suggest what comes next as dimmed text after your cursor. **Tab** keeps it,
**Esc** refuses it (Esc then does not close the message), and typing the first words of it keeps the rest
in place. Turn it on under **Settings → AI Features → Text completion**, where you also choose how much it
writes at once: a **sentence**, a **paragraph**, or the **full message** (signature aside). It is off until
you turn it on. It has a model of its own, **Completion model**, on the provider you chose for the
AI-enabled features. The default is `openai/gpt-4.1-nano`: a suggestion only helps when it arrives as you
type, so pick a small model that answers directly, not a reasoning one.

What leaves your computer: after you pause typing, the text before and after your cursor, the message you
are answering and the few before it in the conversation, the subject and who you are writing to, to the
provider you chose. Only text at the end of a paragraph is completed, and a failed request is logged once
a minute at most, not on every pause. A reply opened again from a saved draft or in its own window has the
quoted message but not the earlier ones.

## Logos and photos

Senders get a logo instead of initials where it is safe to show one, and each of your accounts is
marked by its logo instead of a colored dot (the ring around it keeps the account's color).

- **Company logos** appear on automated and bulk mail (newsletters, notifications) from a
  company's own domain. MiniMail looks for the brand's BIMI logo (the email-industry standard,
  published in DNS), then the icon the sender's homepage declares, then `/favicon.ico`.
- **People's photos** come from Gravatar, for people who write from Gmail, Outlook, Hotmail and
  similar, and for people at companies. This is **off by default**: Gravatar is a third party and
  is sent a hash of each sender's address, so it learns who writes to you. Turn it on in the
  account menu, under Logos.
- **Only for verified senders.** A From address is easy to forge, and a trusted brand's logo on
  a fake message would lend it false trust. A logo or photo appears only when the receiving
  server verified the sender (DMARC pass, or DKIM pass for the From domain, read from the
  topmost `Authentication-Results` header). Mail from sending services (SendGrid, Mailchimp,
  ...) keeps initials, since their logo would stand for someone else.
- **Your accounts**, in order of preference: a **picture you choose** (the image button next to
  an account in Manage accounts; it is cropped and shrunk to 128 px and stored with the account);
  your Gravatar photo, for an address on Gmail, Outlook, Hotmail and similar, if People's photos
  is on; the **site's icon**, for an address on your own domain (a company or university), looked
  up from that domain and independent of the switches above; and finally the provider's mark.
  There is no automatic way to get a Google profile photo: Google only shares it through its
  sign-in (OAuth), which an app password does not go through, so choose a picture instead.

Both switches are in the account menu (bottom of the rail). With both off, nothing is fetched
for senders. What it contacts and how:

- Requests are made by the app itself (never the page), to public hosts only: https, default
  port, no credentials, and never a loopback, private-network or link-local address. That is
  checked on the address actually connected to, on every redirect and for addresses written into
  a URL, so a sender cannot use it to probe your network. Size and time are capped, and only real
  images are accepted (sniffed from the bytes, not trusted from the server).
- The sender's server can see a request from your IP shortly after mail arrives. It is the same
  thing a tracking pixel would tell them, which is why remote images in mail stay blocked and why
  this is limited to verified senders; turn "Company logos" off if you would rather not.
- Results are kept in `logos.json` in the app's data folder, encrypted with the OS keychain like
  your passwords (people are stored under a hash, never an address), for 30 days when found and
  7 when not; a failed attempt is retried within minutes.
- Outlook accounts read the verification from the message headers Microsoft Graph returns. The
  whole Outlook path (sign-in, lists, replies, the startup copy, waiting out Microsoft's rate
  limits) is covered by tests but has not been tried against a live Outlook account.

## First run

On a fresh install, with no account yet, a setup guide opens in the middle of the window:

1. **Connect your email**: add at least one account. It cannot go on without one.
2. **Connect an AI provider**: needed for AI sorting. Pick the Vercel AI Gateway, OpenRouter or the
   TypeSafe API and add its key. It is stored encrypted on this computer.
   Without it, mail is still sorted by simple rules.
3. **Categories** (optional): a look at the categories mail is sorted into, with a button to edit them in Settings.

**Skip setup** closes it at any step. Finishing or skipping is remembered and the guide does not come back;
if you quit halfway, it reopens at the first step still missing. Everything it does can be done later in
Settings. People who set MiniMail up before the guide existed never see it.

## Adding your accounts

Open the avatar at the bottom of the rail, then **Add account**. Enter your email
address and continue. MiniMail suggests a provider from the address and its
domain's mail records. You can also choose your provider directly.

### Other email (including Zoho Mail)

Enter your email address or choose **Other email**. MiniMail looks up IMAP and SMTP
settings using Thunderbird's configuration database, your provider's published
configuration, and known Zoho domains and mail records. Enter your password or your
provider's app password. MiniMail verifies both connections before saving the account.

Use **Manual setup** to enter or edit server names, ports, encryption, and usernames.
Select **My provider saves a copy of sent mail** if the provider files outgoing mail
automatically.

For Zoho, enable **IMAP Access** under Zoho Mail → Settings → Mail Accounts. If you use
two-factor authentication, create an app password in Zoho Accounts → Security → App
Passwords. Existing Zoho accounts retain their saved credentials and server settings.

### Gmail and Google Workspace

Choose **Continue with Google**, select your account in your browser, and allow
Gmail access. A Google Workspace administrator may need to approve MiniMail.
If your account supports app passwords, you can also generate one at
`myaccount.google.com/apppasswords` and use **Add with app password**.

### Outlook and Microsoft 365

Choose **Continue with Microsoft** for personal, work, and school accounts.
Microsoft handles sign-in and any MFA in your browser. If Microsoft shows
**Need admin approval**, ask your organization to approve MiniMail. Use
**Advanced settings** to enter a tenant ID or domain if your IT administrator
provides one.

Use **Reconnect** under an account's connection options if access expires.
Microsoft calendar access can be granted separately when you first respond to
an invitation or from the account's connection options.

### OAuth for local development

For a development build, put your OAuth settings in `.env.local` using
[`.env.example`](../.env.example). For Google, create a **Desktop app** OAuth
client in Google Cloud. An external consent screen in Testing issues Gmail
refresh tokens that expire after seven days. Microsoft sign-in works out of the
box with MiniMail's built-in (public) client ID; to use your own, set
`MAIN_VITE_MICROSOFT_CLIENT_ID` and register an app with **Accounts in any organizational directory and personal Microsoft
accounts** and add `http://localhost` under **Mobile and desktop applications**.
Configure delegated Graph permissions `User.Read`, `Mail.ReadWrite`,
`Mail.Send`, and `offline_access`. Add `Calendars.ReadWrite` for optional
invitation responses. See the [release guide](macos-release.md) for public builds.

## The CLI for AI agents

MiniMail has a `minimail` command that lets an AI agent on your computer, such as Claude Code, Codex or Cursor, work with your mail. It is **off** until you turn it on in **Settings, CLI** (or in the last, optional step of the setup guide).

- **Only what you allow.** Each command has its own switch, in groups. **Read** (list, search, show, refresh, wait, categories, contacts), **Organize** (archive, trash, spam, mark read, pin, category, priority, mute, block, undo), **Drafts** and **Ask first**. Each change an agent makes is recorded in the Log as "via CLI" with an Undo, and `minimail undo` takes back its own changes.
- **Nothing changes on screen when it reads.** Reading never opens a message and never marks it as read. Each read leaves one quiet row in the Log.
- **Drafts are for you.** An agent can write drafts (new, reply, reply all, forward, with files) that appear in Drafts. It never sends one on its own, and it only changes drafts it wrote itself.
- **Sending asks you first.** Sending a message, unsubscribing and answering an invitation cannot be undone, so MiniMail shows a card with exactly what will happen and waits: **Reject**, **Allow once** or **Always allow**. For sending, "always allow" adds the recipients to a list; a message goes out without asking only when everyone on it, Cc and Bcc included, is on that list. A draft with files the agent attached always asks. You can also let it send to anyone (Settings warns you first) or turn any of these off.
- **Sign-in codes are never given out.** A message that contains one comes back as withheld, without its text, and a search cannot find it by its words; an agent cannot reply to or forward it either. Anyone can email an agent instructions to pass a code on, and a code can be enough to take over an account. Detection uses rules and, when AI sorting is set up, its model: it catches most codes, not all.
- **Links are hidden.** Every link in mail reaches the agent as `[link example.com]`, so a password reset or sign-in link never does. You can turn that off; the page warns you first.
- **The skill.** When you turn the CLI on, MiniMail asks whether it may also install a short skill file for all your agents. The file teaches them to use the command and to treat mail as untrusted. It goes in `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex, Cursor, Gemini CLI, GitHub Copilot and others). It is removed when you turn the CLI off, and MiniMail never touches a file it did not write.
- **In your own terminal.** While the CLI is on, MiniMail keeps a link at `~/.local/bin/minimail` (make sure that folder is on your PATH; "Use minimail in your terminal" turns it off). Agents try `minimail` first and use the full path if the shell cannot find it. `minimail help` lists everything, and `minimail show <id> --headers` shows where a message came from without its text.
- **Who can use it.** While it is on, any program running as you can use the command, so keep it off when you do not need it. It does not work from other users or other computers.

## Updates

The installed app looks for a new version on this repository's newest [release](https://github.com/nicolasakf/MiniMail/releases/latest) when it starts and once a day, and shows a notice when there is one. **Update** downloads it (the signed, notarized zip of the release; macOS only accepts an update signed by the same developer), then **Restart and update** installs it. If you close the notice, it is not shown again for that version, and **Settings, Advanced** still offers the update. A downloaded update also installs the next time MiniMail quits. **Settings, Advanced** turns the automatic check off; **Check for updates** there always works. A development run (`npm run dev`) never updates itself. A failed check is recorded in the Log.

## Layout

```
src/shared     types, mail classifier, threading, inbox list builder, IPC contract (pure, tested)
src/main       Electron main: accounts store (keychain), OAuth, IMAP/Graph providers, IPC
src/preload    the only bridge the page gets (window.minimail)
src/renderer   React interface, shared UI controls in components/ui, demo backend in lib/demo.ts
```

How mail is sorted: calendar invites and replies by their MIME type or subject; automated
senders (`no-reply`, `notifications`, GitHub, Amazon, ...) as Notifications; bulk mail with
`List-Unsubscribe` / `List-Id` / `Precedence: bulk` as Newsletters; everything else is a
person. The rules live in `src/shared/classify.ts`.

## Security notes

- Secrets are encrypted with `safeStorage`, and so is the list copy that speeds up startup; if
  the keychain is unavailable nothing is saved.
- The page runs with context isolation and sandbox on, no Node access, a strict CSP in
  production builds, and only `http(s)` / `mailto` links ever reach the system browser.
- Every call from the page is validated with zod in the main process (`src/shared/schemas.ts`).
- Email HTML is stripped of scripts, forms and frames, then rendered in a script-less sandboxed
  frame whose CSP blocks everything except inline styles and (once allowed) images.
