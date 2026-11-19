![MiniMail: email made simple.](docs/images/hero.svg)

Email got overcomplicated over the years: 

- **Slow.** Mail takes forever to load, open and search.
- **Unreliable.** Sync stalls and sends fail, and it's hard to understand why.
- **Overwhelming.** Ads, spam and mail you never asked for bury the mail that matters.
- **Hard to search.** By sender, subject or attachment: slow, and often the wrong results.

MiniMail is a desktop email client built on a different question:

> ### What is the minimum number of things an email really app needs?

## The minimum

![Traditional email: a mail client with nested folders such as Inbox, FYI, This Month, Drafts, Archive, Documents, Junk E-mail and Outbox. MiniMail: four filter buttons (Inbox, Archive, Trash and Spam) and category cards for Invitations, Newsletters, Ads, Notifications, Receipts and Verification codes.](docs/images/before-after.svg)

- **Four places.** Inbox, Archive, Trash and Spam are four buttons above the list. There are no folders to create, nest or tidy.
- **Categories that sort themselves.** Newsletters, ads, notifications and codes each collapse into one row. You describe a category in plain words and AI files the mail.
- **Fast.** Your last inbox is on screen as soon as the window opens.
- **Nothing fails silently.** A send is confirmed or the error is shown, and every failure goes into a Log.
- **Sandboxed mail.** No scripts, no forms, and no remote images until you allow them.
- **One inbox, no server.** Gmail, Outlook, Zoho and any IMAP account in one list. Credentials stay in your OS keychain.

## Run it

```bash
npm install --legacy-peer-deps
npm run dev        # the desktop app
npm run dev:web    # the UI alone, with demo data and no accounts
```

Google and Microsoft sign-in in a development build needs your own OAuth client ids in `.env.local` (see [`.env.example`](.env.example)). The rest is in the [guide](docs/guide.md): adding accounts, OAuth setup, AI sorting (it needs your own key), shortcuts and privacy.
