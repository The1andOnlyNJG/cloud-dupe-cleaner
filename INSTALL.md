# Install the Android app

This is a sideload of the release APK, not a Play Store install. A build with no OAuth client IDs stays in sample mode. A build that was given the Dropbox app key and Google Android client ID at build time signs in to those two accounts. OneDrive says Coming soon. Google Photos stays on sample files.

## Install

1. Copy `cloud-dupe-cleaner-release.apk` onto the phone.
2. On the phone, allow the Files (or browser) app to install unknown apps. The setting is under the app’s Install unknown apps permission.
3. Open the APK and tap Install.
4. Open Cloud Dupe Cleaner. The screen should say “Demo data. No account sign-in.”

Package name: `com.njg.clouddupecleaner`.

## Test on the phone

1. On a build with client IDs, Connect on Dropbox and Google Drive opens that provider's sign-in. OneDrive says Coming soon and does not open a browser. Google Photos still says Connect sample. On a build without client IDs, Dropbox and Drive also use sample files.
2. Tap Scan for duplicates. You should see content-hash groups and at least one weaker name-and-size group. Google Photos rows say “No trash API” and have no trash checkbox.
3. In a Dropbox or Drive group, select one extra copy and leave one copy unselected. Tap Move selected to trash, read the dialog, and confirm. The selected copy leaves the list. The message is about trash, not permanent deletion.
4. Select every copy in a group and tap Move selected to trash. The app should refuse and tell you to leave one copy.
5. On a Google Photos group, tap Review Photos copies. Read the manual steps, then add the copies to the review album. Scan again and confirm those photos are still listed.

Uninstall from the Android app settings when you are done. Uninstalling removes the encrypted token store.
