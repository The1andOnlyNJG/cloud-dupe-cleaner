# Release checklist

These steps need Nick. The app cannot create OAuth clients, buy a host, or submit a store listing.

## OAuth clients

Create one client per provider and keep the secrets on the server, not in the Android app or the git repo.

- Google Cloud Console: an Android OAuth client for package `com.njg.clouddupecleaner` and the SHA-1 of the release cert `73:0C:21:9F:6E:F5:2A:76:2D:E5:EC:F7:EC:A0:32:B5:18:AE:D5:89`. Put the consent screen in Testing and add the Google accounts that may sign in. Add `https://www.googleapis.com/auth/drive.readonly` for scanning. Add `https://www.googleapis.com/auth/drive` as well, because Google has no trash-only scope; the app asks for it only after you confirm a move to trash. Do not put a client secret in the app.
- Dropbox App Console: enable PKCE and add the redirect URI `clouddupecleaner://oauth`. Enable `files.metadata.read`, `files.content.read`, and `files.content.write`. The write scope is requested only after you confirm a move to trash. No app secret goes in the APK.
- Pass `CDC_GOOGLE_CLIENT_ID` and `CDC_DROPBOX_APP_KEY` as environment variables or in `android/local.properties` when building. Do not commit them.
- Sign the release APK with the same certificate that was registered on the Google Android client. A debug keystore will not pass Google's installed-app check. Dropbox does not check that certificate.
- Microsoft Azure, when OneDrive is added later: redirect `https://YOUR_HOST/auth/onedrive/callback`, scopes `Files.Read`, `offline_access`, and `Files.ReadWrite` only for trash. The Android app shows OneDrive as coming soon.
- Google web client, if the server signs in for Drive or Photos: redirects `https://YOUR_HOST/auth/gdrive/callback` and `https://YOUR_HOST/auth/gphotos/callback`.

Until the Android IDs are supplied at build time, Dropbox and Drive stay in sample mode. Google Photos stays on sample files either way.

## Host and HTTPS

- Pick the public host and point DNS at it.
- Terminate TLS there. Set `PUBLIC_BASE_URL` to `https://` that host so the session cookie is `Secure` and HSTS is sent.
- Set `NODE_ENV=production`, `MOCK_PROVIDERS=false`, and an explicit `PERSIST_TOKENS`.
- Generate `SESSION_SIGNING_KEY`. If tokens are persisted, generate a separate `TOKEN_ENCRYPTION_KEY`.
- Do not commit `.env`, `local.properties`, or `*.jks`.

## Android signing and store

The release APK from this repo is unsigned. On your machine:

```bash
apksigner sign \
  --ks cdc-release.jks \
  --ks-key-alias cdc-release \
  --out cloud-dupe-cleaner-release.apk \
  cloud-dupe-cleaner-release-unsigned.apk
apksigner verify --verbose cloud-dupe-cleaner-release.apk
```

`apksigner` asks for the keystore and key passwords. Do not put them in the command line if the shell history is shared.

Then create the Play Console listing, upload the signed APK or AAB, and add the privacy policy from `PRIVACY.md`.
