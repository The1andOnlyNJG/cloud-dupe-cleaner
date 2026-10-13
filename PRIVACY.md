# Privacy policy

Cloud Dupe Cleaner finds duplicate files in Dropbox, OneDrive, Google Drive, and Google Photos, then moves extras to the provider trash after you confirm. This policy describes the web app and the Android app.

## Demo mode

The Android release build and the default web server ship with no OAuth client IDs. In that mode the apps use built-in sample files. They do not open a provider login and they do not send file names, tokens, or other data to Dropbox, Microsoft, or Google.

The Android screen says “Demo data. No account sign-in.” Connect sample, scan, and trash actions stay on the phone.

## Data the apps handle

When you connect a real account later, the apps handle:

- OAuth access tokens and refresh tokens for the accounts you connect
- File names, paths, sizes, and content hashes returned by that provider
- Your choices about which copies to move to trash or, for Google Photos, which items to add to a review album

Content hashes are the provider’s own hash (Dropbox content hash, Drive MD5 or SHA-1, OneDrive SHA-1 or quickXor). If a provider does not give a hash, the app compares file name and size and labels that match as weaker.

The apps do not sell data, do not show ads, and do not include an analytics SDK.

## Where tokens are stored

On the web, tokens stay on the server. The browser receives an HttpOnly session cookie, not the access token. Tokens are kept in server memory unless `PERSIST_TOKENS=true`, in which case they are written as AES-256-GCM ciphertext. The encryption key is not stored in the repository.

On Android, tokens are stored with EncryptedSharedPreferences. The master key is in the Android Keystore. App backup and device transfer exclude those preferences. If the keystore cannot be opened, demo tokens stay in process memory and are not written to plaintext preferences. The app does not log token values.

## Deletes

Dropbox, Google Drive, and OneDrive moves go to that service’s trash or recycle bin, and only after you confirm. The apps do not call the providers’ permanent-delete APIs. At least one copy in each duplicate group is left in place.

Google Photos cannot be trashed through its API. Those copies stay in your library. You can add them to an album named “Duplicate review” and then delete them yourself in Google Photos. Creating that album does not delete the photos.

## What is sent to providers

In demo mode, nothing.

In live mode, each connected provider receives the OAuth requests and the file-list and trash or album requests needed for the action you confirmed. File metadata is not sent to a different company’s API. Disconnect removes that provider’s token from the session (web) or encrypted store (Android).

## How long data is kept

Web sessions live until they expire, you disconnect, or the server process stops. If token persistence is off, a restart drops them. Android tokens remain in encrypted storage until you disconnect or uninstall the app.

## Contact

Questions about this policy can be sent to the maintainer of the Cloud Dupe Cleaner repository.
