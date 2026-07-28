# Cloud Dupe Cleaner

**Real Windows desktop app** (Electron) that finds duplicate files across:

- Dropbox
- OneDrive
- Google Drive
- Google Photos

Double-click the final `.exe` and it works like a normal Windows program.

---

## What is finished right now

- Full Electron desktop shell
- Clean modern dark UI
- Settings page to save your API keys (required once)
- Real OAuth login flow for Google, Dropbox, and OneDrive (opens your browser, captures the login, stores the token)
- Connect / Disconnect buttons that actually work
- Token storage that persists between runs

## What is still being completed

- Full file scanning + hash-based duplicate detection across the connected accounts
- Showing the duplicate groups in the UI
- Safe multi-select delete

---

## How to run it right now (developer mode)

1. Install Node.js from https://nodejs.org
2. Download / clone this repo
3. Open a terminal **inside the project folder** and run:

```bash
npm install
npm start
```

The app window will open.

---

## How to turn it into a normal Windows installer (.exe)

After `npm install`, run:

```bash
npm run dist
```

When it finishes, open the `dist` folder. You will find an installer. Double-click it and the program installs like any other Windows app. After that you never need the terminal again.

---

## Important: API Keys (one-time setup)

Because this app accesses **your** personal cloud files, each provider forces you to create a free app and copy the Client ID / Secret.

1. Open the app → click **Settings**
2. Create the free apps:
   - Google → Google Cloud Console → OAuth Client ID (Desktop or Web)
   - Dropbox → Dropbox App Console → App Key + Secret
   - Microsoft → Azure App Registrations → Application (client) ID
3. Paste the values into Settings and click Save Keys
4. Then click Connect on each service

After this one-time setup the app remembers everything.

---

I am continuing to finish the scanning and deletion engine next.
