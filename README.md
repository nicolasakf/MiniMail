# MiniMail

A desktop email client modeled on Spark's **Focused List** (smart inbox), styled with the
Orion app's design tokens and shadcn components. It connects to Gmail, Outlook (personal and
work/school), Zoho Mail, and other IMAP accounts, all in one inbox.

Electron + React 19 + Tailwind 3 + Radix/shadcn. Mail is read straight from your providers
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
`?getfail=2` makes the first two opens fail (then "Try again" works).

## What it does

- **Focused List** on the Inbox: mail from people as normal rows; Notifications, Newsletters,
  Invitations, Invitation responses and Pinned collapsed into one row each, with sender chips.
  Click a group to open its own list (Back or Esc returns). Hover a group to archive all of it.
- Date sections (Today, Yesterday, Last Week, then months), conversation threading with a
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
  the Focused List above), **Sender** and **List** (plain, by date). Tab cycles through the
  tabs, Shift+Tab goes back. Sender adds a panel next to
  the rail with every address the folder has mail from; pick one to list its mail, or group the
  panel by domain and expand a domain to see its senders. Opening a conversation there keeps
  the panel and replaces only the list.
- **Categories you define**, sorted by AI. See the next section.
- Conversation view, reply / reply all / forward, compose with account picker.
- Select mode (the pill switch) for bulk actions, search (loaded mail), light/dark/system theme.
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
`#` / `Delete` trash, `P` pin, `U` read/unread, `X` select, `C` compose, `⌘K` search, `/` opens the menu of the selected item (also on right-click; type to filter its commands), `⌘Z` undoes the last archive / trash / spam / delete, `⌘↵` send.

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

Categories are the groups in the Focused List. MiniMail starts with
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
   TypeSafe AI's System One model, through the **Vercel AI Gateway** (`typesafe-ai/jev`). Jev
   answers one multiple-choice question over your categories plus "None of these", and the
   answer is stored for the conversation.
2. **Replies** inherit the category of their conversation; they never cost another call.
3. Below 40% confidence, or "None of these", the conversation stays a normal row.
4. Until Jev answers, or with no key, a built-in guess from the mail headers (calendar invite,
   bulk-mail headers, automated sender) files mail under the matching built-in category.

To turn AI sorting on, create an API key in the Vercel dashboard (AI Gateway, API Keys), open
**Categories**, paste it and save. It is stored encrypted with your system keychain, and
**Test connection** makes one real call so a bad key shows up immediately. Only the Inbox is
classified, a few at a time, and after a failure MiniMail pauses its calls for a while instead
of retrying in a loop.

What leaves your computer: for each new conversation, the sender, the subject and about 500
characters of the body. Digit runs (codes) and the path and query of every link (magic-link
tokens) are replaced with placeholders first. Nothing is sent without a key.

Editing criteria does not re-sort mail that already has a category; use **Sort all mail again**
(or the button on the "Categories saved" notice) to run everything through the new criteria.
A toast follows the run ("5 of 40" with a bar) and ends with how many conversations were sorted, or
why it stopped. The total is what has been queued so far, so it can grow as each account's inbox loads.
Deleting a category re-sorts the conversations that were in it on the next refresh.

"Replied" comes from the mailbox: IMAP's `\Answered` flag (MiniMail sets it when you reply from
here) and, for Outlook, the last-verb property Outlook writes when you reply. Replies and
forwards from an Outlook account go out through Outlook's own reply draft, so they stay in the
conversation in every Outlook client and the original is marked as replied there too.

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
[`.env.example`](.env.example). For Google, create a **Desktop app** OAuth
client in Google Cloud. An external consent screen in Testing issues Gmail
refresh tokens that expire after seven days. For Microsoft, register an app
with **Accounts in any organizational directory and personal Microsoft
accounts** and add `http://localhost` under **Mobile and desktop applications**.
Configure delegated Graph permissions `User.Read`, `Mail.ReadWrite`,
`Mail.Send`, and `offline_access`. Add `Calendars.ReadWrite` for optional
invitation responses. See the [release guide](docs/macos-release.md) for public builds.

## Layout

```
src/shared     types, smart-inbox classifier, threading, Focused List builder, IPC contract (pure, tested)
src/main       Electron main: accounts store (keychain), OAuth, IMAP/Graph providers, IPC
src/preload    the only bridge the page gets (window.minimail)
src/renderer   React UI; components/ui are copied from Orion; lib/demo.ts is the demo backend
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
