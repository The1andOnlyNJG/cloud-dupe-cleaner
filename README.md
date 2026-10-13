# Cloud Dupe Cleaner

Web app and Android app that find duplicate files in Dropbox, OneDrive, Google Drive, and Google Photos.

Demo mode is the default. It uses sample files and does not contact those services, so you can run it without API credentials.

## Web app

```bash
npm install
npm start
```

Open http://127.0.0.1:3000

Connect a sample account, scan, and move a duplicate to trash. The move is refused until you confirm, and Google Photos items cannot be trashed. For Photos, add them to a review album or follow the manual steps.

Checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## How duplicates are chosen

- Dropbox: `content_hash`
- Google Drive: MD5, or SHA-1 when that is all Drive returns
- OneDrive: SHA-1 or quickXor when Graph provides it
- Otherwise: file size plus name, labeled as a weaker match
- Google Photos does not provide a content hash. Items with no byte size are shown only when a size exists in the sample data. The live Photos API does not include byte size, so those items are not guessed into a group.

Hashes are only compared inside the same algorithm.

## Trash, not permanent delete

- Dropbox `files/delete_v2` moves a file to deleted files
- Google Drive `files.update` sets `trashed: true`. `files.delete` is refused
- OneDrive `DELETE /me/drive/items/{id}` moves a file to the recycle bin. `permanentDelete` is refused
- Google Photos has no trash API. The app will not send a delete. It can add items to an album named "Duplicate review" and shows the manual steps

Every trash call requires the confirmation `MOVE_TO_TRASH` and leaves at least one copy in the group. Scanning uses read scopes. Trash and album scopes are requested only after you ask for that action.

## Live OAuth

Set `MOCK_PROVIDERS=false` and the client ids in `.env` (see `.env.example`). Secrets stay on the server. The browser never receives access tokens. Production refuses to start until `MOCK_PROVIDERS`, `PERSIST_TOKENS`, and `SESSION_SIGNING_KEY` are set explicitly. Token files are written only when `PERSIST_TOKENS=true`, and then only as AES-256-GCM ciphertext.

## Android

The Android project is in `android/`. Demo mode is on and does not open a provider login. Tokens go through `EncryptedSharedPreferences` and the Android Keystore. Backups are off, cleartext traffic is off, and the only exported components are the launcher and the OAuth redirect activity.

Logic tests (JDK 21, no Android SDK):

```bash
cd android
gradle :core:test
```

Install the debug app with Android Studio or `gradle :app:assembleDebug` once `ANDROID_HOME` is set.
