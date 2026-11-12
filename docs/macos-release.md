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

The public build runs in release mode, which excludes local OAuth credentials.
Use Gmail or Zoho app passwords with the downloaded installer. For Outlook or
Google OAuth, configure your own client using the instructions in the README
and run a local development build.
