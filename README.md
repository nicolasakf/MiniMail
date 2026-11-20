![MiniMail: email made simple.](docs/images/hero.svg)

Email got overcomplicated over the years: 

- **Slow.** Mail takes forever to load, open and search.
- **Unreliable.** Sync stalls and sends fail, and it's hard to understand why.
- **Overwhelming.** Ads, spam and mail you never asked for bury the mail that matters.
- **Hard to search.** By sender, subject or attachment: slow, and often the wrong results.

MiniMail is a desktop email client built on a different question:

> ### How simple can we make it?

## The minimum

![Traditional email: a mail client with six inboxes (Exchange, Gmail, Outlook.com, iCloud, a university account and Yahoo), each with nested folders such as Clients, Active, FYI, This Week, Drafts and Sync Issues, covered in unread counts and error badges. MiniMail: four filter buttons (Inbox, Archive, Trash and Spam) and, apart from them, Sent and Drafts.](docs/images/before-after.svg)

Your mail can be in four places: Inbox, Archive, Trash and Spam. That's it. No written rules, no folders inside other folders.

> Oh, but how am I going to sort and find all my mail in just those four folders? It's going to be a mess, right?

No, because there are categories:

![The Categories screen: a list of categories (Invitations, Notifications, Verification codes, Receipts, Newsletters and Ads) with Receipts open for editing, showing a plain-language description of the mail that belongs in it.](docs/images/categories.svg)

**These categories sort themselves.** Newsletters, ads, notifications and codes each collapse into one card. You describe what type of emails you want in that category and AI files the mail for you.

That way your mail stays findable, and the app around it stays simple and lightweight.

- **Fast.** Your inbox is on screen as soon as the window opens.
- **Nothing fails silently.** A send is confirmed or the error is shown, and every failure or server-side update is transparent to you.
- **Sandboxed mail.** No scripts, no forms, and no remote images unless you allow them.
- **One inbox, no server.** Gmail, Outlook, Zoho or any other IMAP account in one list. Credentials stay in your OS keychain.

![The MiniMail window: a row of category cards (Invitations, Notifications, Verification codes, Receipts and Newsletters) above the conversation list, grouped by Pinned, Yesterday, This Week, Last Week and November, with the folder buttons, Smart, Sender and List views, and the compose button in the toolbar.](docs/images/app.svg)

## Run it

```bash
npm install --legacy-peer-deps
npm run dev        # the desktop app
npm run dev:web    # the UI alone, with demo data and no accounts
```

## Connecting your accounts

**Microsoft sign-in works out of the box** for Outlook and Microsoft 365.

You can connect **Gmail and Google Workspace** in two ways.

1. **Set up your own OAuth client** for the full Google sign-in flow. Create a Desktop app OAuth client in Google Cloud and put its credentials in `.env.local` before running MiniMail from source. [OAuth setup guide](docs/guide.md#oauth-for-local-development)
2. **Use an app password for the fastest and easiest setup.** If your Google Account has 2-Step Verification and supports app passwords, generate one and choose **Add with app password** in MiniMail. [Create an app password](https://myaccount.google.com/apppasswords)

See the [guide](docs/guide.md) for AI sorting (it needs your own key), shortcuts and privacy.
