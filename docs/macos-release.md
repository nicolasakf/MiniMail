# Releasing MiniMail for macOS

MiniMail is released from a Mac that holds the Developer ID certificate and a notarization
profile in its Keychain. There is no CI release: the signing key and the Apple credentials
stay on that Mac. A release is two disk images, for Apple Silicon (`arm64`) and Intel (`x64`),
plus their zips and the `latest-mac.yml` that installed copies update from (see [Updates for installed copies](#updates-for-installed-copies)).

## One-time setup

- A **Developer ID Application** certificate with its private key in the login Keychain.
  `security find-identity -v -p codesigning` lists it.
- A `notarytool` Keychain profile named `MiniMail`, made once with
  `xcrun notarytool store-credentials MiniMail`. `xcrun notarytool history --keychain-profile MiniMail`
  checks that it works.
- Node.js 22.13 or newer, the GitHub CLI (`gh`) signed in, and no other `APPLE_*` or `CSC_*`
  variables in the shell, since they can override the identity or the profile.

## Release steps

The examples release `0.17.1`; use the new version everywhere.

1. Set `version` in `package.json` and in the first two places it appears in `package-lock.json`.
   Commit, push `main`, then tag that commit and push the tag:
   `git tag -a v0.17.1 -m "MiniMail v0.17.1" && git push origin v0.17.1`.
2. Build from a clean export of the tag, so uncommitted work and local files such as `.env.local`
   stay out of the app:

   ```bash
   release=$(mktemp -d)
   git archive v0.17.1 | tar -x -C "$release" && cd "$release"
   npm ci --legacy-peer-deps
   npm run typecheck && npm test
   npm run build:release
   APPLE_KEYCHAIN_PROFILE=MiniMail npm run package:mac
   ```

   `package:mac` builds one app per architecture, signs each with the Developer ID (hardened runtime),
   notarizes and staples it, and writes `dist/MiniMail-0.17.1-mac-arm64.dmg` and `dist/MiniMail-0.17.1-mac-x64.dmg`,
   the matching `.zip` files and one `dist/latest-mac.yml`.
3. Notarize and staple both disk images. Staple only after Apple answers `Accepted`.

   ```bash
   for dmg in dist/MiniMail-0.17.1-mac-{arm64,x64}.dmg; do
     xcrun notarytool submit "$dmg" --keychain-profile MiniMail --wait
     xcrun stapler staple "$dmg"
   done
   ```
4. Check both results (`dist/mac-arm64/MiniMail.app` is Apple Silicon, `dist/mac/MiniMail.app` is Intel;
   `lipo -archs` on the binary says which): `codesign --verify --deep --strict` on the app,
   `xcrun stapler validate` and `spctl --assess --type execute` on the app, and
   `xcrun stapler validate` and `spctl --assess --type open --context context:primary-signature`
   on the disk image. Mount the image and check that it holds `MiniMail.app` and an `Applications` link.
5. Stapling changed the disk images, so refresh their entries in `dist/latest-mac.yml`: the `sha512`
   (`openssl dgst -sha512 -binary "$dmg" | base64`) and the `size` (`stat -f %z "$dmg"`). Installed
   copies read only the zips' entries, which must stay as the build wrote them.
6. Publish. Create the release as a draft, upload the five files, compare each digest with the
   local file, then publish:

   ```bash
   gh release create v0.17.1 --verify-tag --draft --title "MiniMail v0.17.1" --notes-file notes.md
   gh release upload v0.17.1 dist/MiniMail-0.17.1-mac-{arm64,x64}.{dmg,zip} dist/latest-mac.yml
   gh release view v0.17.1 --json assets --jq '.assets[] | "\(.name) \(.digest)"'   # compare with shasum -a 256
   gh release edit v0.17.1 --draft=false
   ```

   Then check that `https://github.com/nicolasakf/MiniMail/releases/latest/download/latest-mac.yml`
   answers with the new version.

## Updates for installed copies

MiniMail looks for a new version on the newest published release of this repository
(`releases/latest/download`, set in `electron-builder.yml` and `UPDATE_FEED_URL` in
`src/shared/updates.ts`). Every release therefore carries five files:

| File | Used by |
| --- | --- |
| `MiniMail-<VERSION>-mac-arm64.dmg` | New installs on Apple Silicon. |
| `MiniMail-<VERSION>-mac-x64.dmg` | New installs on Intel. |
| `MiniMail-<VERSION>-mac-arm64.zip`, `-x64.zip` | Installed copies, which download the one for their Mac, check its hash and replace themselves. |
| `latest-mac.yml` | Installed copies, to learn the newest version and the zip's hash. |

Each zip holds the same signed and notarized app as its disk image. An Intel copy running on Apple Silicon
(under Rosetta) updates to the Apple Silicon build. macOS only lets an app
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

| Variable | Value |
| --- | --- |
| `MINIMAIL_RELEASE_GOOGLE_CLIENT_ID` | Google **Desktop app** OAuth client ID. |
| `MINIMAIL_RELEASE_GOOGLE_CLIENT_SECRET` | Companion credential from the Google desktop client. Google treats installed apps as public clients, and the value is extractable from the installer. Use a dedicated desktop registration. |

Microsoft needs no setting: its Entra client ID is public (PKCE, no secret) and is built
into the app (`MICROSOFT_CLIENT_ID` in `src/main/index.ts`).

Set the two variables in the shell that runs `npm run build:release`; they reach only that
build. Release mode ignores local `.env.local` OAuth settings. If the Google release
settings are missing, browser sign-in for Google is unavailable, and Gmail accounts use an
app password. Releases so far were built without them.
