# Releasing MiniMail for macOS

MiniMail's GitHub release workflow builds an Apple Silicon DMG from the release
tag. It checks the Developer ID signature and Apple's notarization ticket before
publishing the installer.

Set these repository secrets in GitHub Actions:

| Secret | Value |
| --- | --- |
| `MACOS_CSC_LINK` | Base64-encoded Developer ID Application certificate and private key export (`.p12`). |
| `MACOS_CSC_KEY_PASSWORD` | Password used to export the `.p12`. |
| `APPLE_API_KEY` | App Store Connect `.p8` private key, as PEM or base64. |
| `APPLE_API_KEY_ID` | App Store Connect key ID. |
| `APPLE_API_ISSUER` | App Store Connect issuer ID. |

Push a tag matching the version in `package.json`. Create a draft release for the
tag and run `gh workflow run release-macos.yml --ref v<VERSION>`, substituting
the tag for `v<VERSION>`. The workflow publishes the draft after verifying the
app and disk image.

## Updates for installed copies

MiniMail looks for a new version on the newest published release of this repository
(`releases/latest/download`, set in `electron-builder.yml` and `UPDATE_FEED_URL` in
`src/shared/updates.ts`). The workflow therefore uploads three files to each release:

| File | Used by |
| --- | --- |
| `MiniMail-<VERSION>-mac-arm64.dmg` | New installs. |
| `MiniMail-<VERSION>-mac-arm64.zip` | Installed copies, which download it, check its hash and replace themselves. |
| `latest-mac.yml` | Installed copies, to learn the newest version and the zip's hash. |

The zip holds the same signed and notarized app as the disk image. macOS only lets an app
replace itself with a build signed by the same developer. A release published without
`latest-mac.yml` shows no update to anyone, and a copy that cannot read it records
"Could not check for updates" in its Log. Copies older than the first one with this
feature (0.16.2 and earlier) cannot update themselves: install the new version from the disk
image once. A draft release is never offered, since `latest` skips drafts.

## Browser sign-in

Create MiniMail's production OAuth registrations using the platform and
redirect settings in the [guide](guide.md#oauth-for-local-development).
Configure Google for external users and complete Google's
[restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
for the [full Gmail scope required by IMAP and SMTP](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol).
Include MiniMail's optional AI sorting in the review of where Gmail data goes.
Google requires a security assessment when restricted data is stored or transmitted
on servers.
For Microsoft, use an Entra registration that supports both organizational and
personal accounts. Organization-level app approval can still apply.

| GitHub Actions setting | Value |
| --- | --- |
| Repository variable `MINIMAIL_GOOGLE_CLIENT_ID` | Google **Desktop app** OAuth client ID. |
| Repository secret `MINIMAIL_GOOGLE_CLIENT_SECRET` | Companion credential from the Google desktop client. Google treats installed apps as public clients, and the value is extractable from the installer. Use a dedicated desktop registration. |

Microsoft needs no setting: its Entra client ID is public (PKCE, no secret) and is built
into the app (`MICROSOFT_CLIENT_ID` in `src/main/index.ts`).

The workflow passes these settings only to the build step. For a local release
build, the equivalent process variables are `MINIMAIL_RELEASE_GOOGLE_CLIENT_ID` and
`MINIMAIL_RELEASE_GOOGLE_CLIENT_SECRET`.
Release mode ignores local `.env.local` OAuth settings. If the Google release
settings are missing, browser sign-in for Google is unavailable.
