# Cloud Dupe Cleaner

Windows desktop app that finds and removes duplicate files across:

- **Dropbox** (content hash – strong)
- **Google Drive** (md5 – strong)
- **OneDrive** (size + name – weaker)

Looks and feels like a normal Windows program.

---

## What is finished

- Electron desktop shell
- Settings page for your free API keys (required once)
- Real OAuth login for Google, Dropbox, and OneDrive
- File listing from all three services
- Duplicate detection using content hashes (Dropbox + Google) and size+name (OneDrive)
- UI that shows duplicate groups with checkboxes
- Safe delete (you must leave at least one copy)
- Confirmation before any deletion

---

## How to run it

1. Install [Node.js](https://nodejs.org) (LTS version)
2. Download this repo as ZIP and extract it
3. Open the extracted folder in File Explorer
4. In the address bar type `cmd` and press Enter
5. Run these two commands:

```
npm install
npm start
```

The app window will open.

---

## Turn it into a real .exe installer (one-time)

After `npm install`, run:

```
npm run dist
```

When it finishes, open the new `dist` folder. Double-click the installer. After that the program installs like any normal Windows app and you never need the terminal again.

---

## First-time setup (API keys)

1. Open the app → click **Settings**
2. Create free apps and paste the keys:
   - **Google** → [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth Client ID
   - **Dropbox** → [Dropbox App Console](https://www.dropbox.com/developers/apps) → Create app → App key + App secret
   - **Microsoft** → [Azure Portal](https://portal.azure.com/) → App registrations → New registration → Application (client) ID
3. Save the keys
4. Click **Connect** on each service you want to use
5. Click **Scan for Duplicates**

After this one-time setup the app remembers your logins.

---

## Safety

- You must leave at least one file in every duplicate group
- Every delete requires confirmation
- Files are only deleted from the cloud accounts you explicitly connected
