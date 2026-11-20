# Contributing to MiniMail

Bug reports, documentation fixes, and pull requests are welcome. If you’re considering a larger change to the inbox, an issue is a good place to discuss the behavior before writing code.

## Run MiniMail locally

Use Node.js 24 to match the release workflow. From the repository root, run these commands for the browser demo with fictional accounts and messages.

```sh
npm ci --legacy-peer-deps
npm run dev:web
```

Open the URL printed by Vite. Use `npm run dev` for changes that need Electron, such as account sign-in, system notifications, or on-disk mail storage. The [MiniMail guide](docs/guide.md) covers account setup and the demo’s slow-load and error modes.

## Report a bug

Check the [existing issues](https://github.com/nicolasakf/MiniMail/issues) first. Include the MiniMail version or commit, where you ran it, and the shortest steps that show the problem. If you can reproduce it in the browser demo, use those steps so others can follow along without a mail account.

Before sharing a screenshot or Log entry, remove email addresses, message subjects and bodies, verification codes, and credentials. Replace real mail with fictional examples whenever possible.

## Open a pull request

Keep the change focused and explain what you verified. Run type checking and tests for code changes. Run the build too when your change affects the build or packaging.

```sh
npm run typecheck
npm test
npm run build
```

For app changes, read [the project conventions](AGENTS.md). They cover where mail actions should appear, how undo and error reporting work, and when an on-disk change needs a migration and a test with the old format.

Include a screenshot for a visible change when it helps the reviewer. Demo data is ideal.
