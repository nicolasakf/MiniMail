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
| Repository variable `MINIMAIL_MICROSOFT_CLIENT_ID` | Microsoft Entra Application (client) ID. |

The workflow passes these settings only to the build step. For a local release
build, the equivalent process variables are `MINIMAIL_RELEASE_GOOGLE_CLIENT_ID`,
`MINIMAIL_RELEASE_GOOGLE_CLIENT_SECRET`, and `MINIMAIL_RELEASE_MICROSOFT_CLIENT_ID`.
Release mode ignores local `.env.local` OAuth settings. If a provider's release
settings are missing, browser sign-in for that provider is unavailable.
