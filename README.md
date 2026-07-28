# Cloud Dupe Cleaner

**Windows desktop app** that finds and removes duplicate files across:
- Dropbox
- OneDrive
- Google Drive
- Google Photos

Looks and behaves like a normal Windows program. Double-click the .exe and it opens.

---

## Current Status

This is now an **Electron desktop app** structure.

### What works right now
- Clean modern dark UI
- Connection status cards
- Scan / Delete UI layout
- Electron window that opens like a regular program

### What still needs to be finished
1. Real OAuth login flows for each cloud service
2. File listing + hash-based duplicate detection
3. Safe delete confirmation

---

## Important Reality Check

To access *your* Dropbox / Google / OneDrive files, the app **must** use API keys that *you* create (free).  
No app can legally log into your personal cloud accounts without this one-time setup.

After you put the keys in once, the app remembers your login and works like any other Windows program.

---

## How to turn this into a real .exe (one-time)

1. Install Node.js (from nodejs.org) if you don't have it
2. Open the project folder in File Explorer
3. In the address bar type `cmd` and press Enter
4. Run these two commands:

```
npm install
npm run dist
```

When it finishes, look inside the new `dist` folder.  
You will find an installer. Double-click that installer and the program is installed on your computer like any other Windows app.

After that you never need the command line again.

---

## Next Steps I Will Do

I will continue building the real OAuth and scanning logic into this Electron version.
