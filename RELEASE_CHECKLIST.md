# Release checklist

These steps need Nick. The app cannot create OAuth clients, buy a host, or submit a store listing.

## OAuth clients

Create one client per provider and keep the secrets on the server, not in the Android app or the git repo.

- Google Cloud Console: an Android OAuth client for package `com.njg.clouddupecleaner` plus the SHA-1 of the key you use to sign the release APK. Put the consent screen in Testing and add the Google accounts that may sign in.
- Dropbox App Console: an app with redirect `https://YOUR_HOST/auth/dropbox/callback` and scopes `files.metadata.read`, `files.content.read`, and `files.content.write` only after trash is confirmed.
- Microsoft Azure app registration: redirect `https://YOUR_HOST/auth/onedrive/callback`, scopes `Files.Read`, `offline_access`, and `Files.ReadWrite` only for trash.
- Google web client, if the server signs in for Drive or Photos: redirects `https://YOUR_HOST/auth/gdrive/callback` and `https://YOUR_HOST/auth/gphotos/callback`.

Until those IDs are configured, both apps stay in sample mode.

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
