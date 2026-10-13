# Security review

Branch: `feat/build-and-security`
Date: 2026-10-13
Scope: Cloud Dupe Cleaner web app and Android app. Demo providers only. No live account sign-in.

This review records what was fixed on the branch and what Nick still has to do. Nothing here was merged, deployed, or published.

## Checks

| Check | Result |
| --- | --- |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` | Pass, 23 tests |
| `npm run build` | Pass |
| `npm audit` (178 packages) | 0 info, 0 low, 0 moderate, 0 high, 0 critical |
| gitleaks 8.30.1, full git history (5 commits) | No leaks |
| Android `:core:test` (Gradle 8.11.1, JDK 21) | Pass |
| Android `:app:assembleDebug` | Not run. `ANDROID_HOME` is not set in this environment |
| Aikido SAST | Not run. The Aikido server is installed but requires a sign-in, and this task does not sign in to real accounts |

## What changed on this branch

The old Electron app stored OAuth client secrets and access tokens in plaintext `electron-store`, built `state` with `Math.random()`, did not use PKCE, reflected the provider error into HTML, and called Google Drive `files.delete` (permanent). That shell is gone. The app is now a same-origin web server plus an Android project.

Safe fixes applied here:

- Authorization-code OAuth with S256 PKCE. The authorize URL never carries a client secret. `response_type=token` is rejected.
- `state` is 32 random bytes, checked with a length-checked timing-safe compare, expires after 10 minutes, and is single-use. The session id rotates after a successful login.
- Redirect URIs are an exact allowlist (`origin` + path only). Userinfo, queries, fragments, backslashes, `@`, and `..` are rejected. The browser is only sent back to `/?connected=` or `/?error=` with an allowlisted error code.
- Scan scopes are read-only. Trash and album scopes are requested only after the user asks for that action.
- Trash requires the exact confirmation `MOVE_TO_TRASH`, a CSRF header, and at least one remaining copy. The server uses the last scan snapshot, not a client-supplied path.
- Dropbox uses `files/delete_v2` (deleted files, restorable). Drive uses `files.update` with `trashed: true`. OneDrive uses item `DELETE`, which moves the item to the recycle bin. `permanently_delete`, `permanentDelete`, Drive `files.delete`, and Photos batch delete are refused.
- Google Photos is not trashable. The UI flags those rows and offers a "Duplicate review" album plus manual steps. The album call does not delete.
- Web tokens stay on the server. The browser gets an HttpOnly, SameSite=Lax session cookie and a CSRF token. API responses are `Cache-Control: no-store`. Default bind is `127.0.0.1`.
- Optional disk storage is AES-256-GCM. The file mode is `0600` and the directory mode is `0700`. It is off unless `PERSIST_TOKENS=true` and `TOKEN_ENCRYPTION_KEY` is 32 bytes of base64. Production refuses to boot until `MOCK_PROVIDERS`, `PERSIST_TOKENS`, and `SESSION_SIGNING_KEY` are set explicitly. The old `dev-secret-change-me` fallback is gone.
- Android tokens use `EncryptedSharedPreferences` with a `MasterKey` (`AES256_GCM`) in `AndroidKeyStore`. If the keystore cannot be opened, the fallback is process memory, not plaintext preferences.
- `allowBackup="false"`, backup and device-transfer rules exclude shared preferences, files, and databases, cleartext traffic is off, and only system CAs are trusted.
- Exported components are the launcher activity and the OAuth redirect activity (`clouddupecleaner://oauth`). The redirect activity checks `state` with `MessageDigest.isEqual` and does not display, log, or store the authorization code. There are no exported providers, services, or receivers.

## OAuth and scopes

| Provider | Scan scope | Extra scope, only after confirm | Why it is the smallest fit |
| --- | --- | --- | --- |
| Dropbox | `files.metadata.read` and `files.content.read` | `files.content.write` | Metadata includes `content_hash`. `files.content.read` is only for `get_thumbnail` previews, not full-file downloads. `delete_v2` needs content write. |
| OneDrive | `Files.Read` plus `offline_access` | `Files.ReadWrite` | Own drive only, not `Files.ReadWrite.All`. `offline_access` is for refresh, not more files. Item delete moves to the recycle bin. |
| Google Drive | `drive.readonly` | `https://www.googleapis.com/auth/drive` | `drive.file` cannot see or trash files this app did not create. Google has no trash-only scope. |
| Google Photos | `photoslibrary.readonly` | `photoslibrary.appendonly` for the review album only | The Library API cannot trash items, so there is no delete scope. |

`offline` / refresh is requested so the server can refresh without asking the user to sign in on every scan. Microsoft uses the `common` tenant so work and personal OneDrive both work.

## Token storage

Web, default: tokens live in the server process only. They are not in `localStorage`, not in the HTML, and not in JSON responses. Tests assert the mock and live token strings never appear in API bodies.

Web, opt-in: `PERSIST_TOKENS=true` writes one AES-256-GCM blob. The key is not in the repo. A wrong key fails closed and the process starts with an empty store instead of writing plaintext.

Android: `SecureTokenStore` opens `AndroidKeyStore` before creating `EncryptedSharedPreferences` (AES-256-SIV keys, AES-256-GCM values). There is no `MODE_WORLD_READABLE` and no `Log` of token values.

## Secrets in git history

gitleaks 8.30.1 scanned all 5 commits and reported no leaks.

The old tree contained placeholders, not live credentials:

- `SESSION_SECRET=change-this-to-a-long-random-string` in `backend/.env.example`
- fallback `'dev-secret-change-me'` in `backend/server.js`
- an HTML placeholder `GOCSPX-...` that was not a real Google secret
- empty `GOOGLE_CLIENT_SECRET`, `DROPBOX_CLIENT_SECRET`, and `MICROSOFT_CLIENT_SECRET`

Those strings are removed from the current tree. `.env` and `data/` are gitignored. `.env.example` has empty values.

## User data

Demo mode never calls Dropbox, Microsoft, or Google. It uses built-in sample files.

Live mode sends file metadata only to the provider the user connected. The server keeps names, paths, sizes, and content hashes in the session so a trash request can be checked against the scan. It does not log tokens or file lists. Disconnect deletes that provider's token and the scan snapshot. Hashes are compared only inside one algorithm (Dropbox content hash, MD5, SHA-1, or quickXor). Name-and-size matches are labeled weaker and are used only when the provider did not give a hash.

## Dependency vulnerabilities

`npm audit` reports zero vulnerabilities at every severity. The runtime dependencies are `express` and `helmet`. The old `googleapis`, Dropbox SDK, Electron, and `electron-store` dependencies were removed with the desktop shell.

## Android storage, backup, and exported components

`AndroidManifest.xml`:

- `android:allowBackup="false"`
- `android:fullBackupContent="@xml/backup_rules"` and `android:dataExtractionRules="@xml/data_extraction_rules"` exclude shared preferences, files, and databases for cloud backup and device transfer
- `android:usesCleartextTraffic="false"` and a network security config that allows only system trust anchors
- `android:exported="true"` on exactly two activities: `MainActivity` (launcher) and `OAuthRedirectActivity` (browsable `clouddupecleaner://oauth`)
- no `<provider>`, `<service>`, or `<receiver>`
- release `isDebuggable` is false

Client ids are empty `BuildConfig` fields. The sample connect path does not open a browser. A live connect path exists only when a client id is non-empty, and this build does not contain one.

## Residual items for Nick

| Severity | Item | Action |
| --- | --- | --- |
| Medium | The old Electron screen stored client secrets and tokens in plaintext on the PC, if it was ever used with real keys. Those values are not in git. | If real Google, Dropbox, or Microsoft secrets were pasted into that screen, rotate them in each developer console and delete the Electron user-data store. |
| Medium | `https://www.googleapis.com/auth/drive` can permanently delete as well as trash. Google does not offer a trash-only scope. | Keep the app on `files.update` with `trashed: true`. Do not add `files.delete`. Use Google's restricted-scope verification before a public client. |
| Medium | Dropbox `files.content.write` and OneDrive `Files.ReadWrite` can also call permanent-delete endpoints. | Keep the URL guard. Do not add `Files.ReadWrite.All` or a call to `permanently_delete` / `permanentDelete`. `files.content.read` is limited to thumbnail previews. |
| Low | Web access tokens are plaintext in process memory. Disk encryption applies only when persistence is turned on. | For a shared or production host, set `SESSION_SIGNING_KEY` and, if you persist sessions, `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`). Serve HTTPS so the cookie gets `Secure`. Leave `HOST=127.0.0.1` unless a reverse proxy terminates TLS. |
| Low | If any process was actually started with `SESSION_SECRET=dev-secret-change-me`, that default was guessable. gitleaks did not find a live secret. | Rotate that deployment's session secret. No cloud API key was found in history, so there is no leaked provider key to rotate from the repo itself. |
| Low | `photoslibrary.appendonly` can fail when adding photos this app did not upload. The API still cannot trash them. | Treat a failed album as the manual-steps path. Google may also require Photos API approval before production use. |
| Low | If the Android Keystore cannot be opened, demo tokens stay in process memory (`MemoryTokenStore`). | Do not replace that with plaintext `SharedPreferences`. Fix the device keystore instead. |
| Info | `androidx.security:security-crypto:1.1.0-alpha06` is still an alpha. | Move to a stable AndroidX security release when one is published. |
| Info | The OAuth redirect activity must be exported for the browser to return. | Keep the intent filter on `clouddupecleaner://oauth` only. State is checked before the code is accepted. |
| Info | This environment has no Android SDK, so no APK was built. | Open `android/` in Android Studio, or set `ANDROID_HOME` and run `:app:assembleDebug`. `:core:test` already covers duplicate matching, the trash rules, PKCE, and redirect rejection. |
| Info | Aikido SAST did not run. | Sign in to Aikido locally if you want that scan. This run did not, because it does not sign in to real accounts. |
