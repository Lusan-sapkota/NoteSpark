# NoteSpark for desktop

An Electron app that runs NoteSpark's screens on a computer, with the same notes, tasks, profiles, backups and search by meaning as the phone app. Everything stays on the computer: there is no account, no server, no analytics and no update checks. The app makes no network requests of its own.

**Status:** in development. It builds and runs on Linux (AppImage). Syncing with the phone is not built yet. Windows and macOS are untested.

## What it does

- All the phone's screens (notes, editor, tasks, scratchpad, bin, import and export, settings, profiles with PIN and encryption) on one shared set of code, with the same data format.
- **Web view** (off by default): use the app from a browser on another device on your own network. It answers private addresses only and needs a link with a random code. See the privacy policy in the app.
- **Search by meaning** with a small model that ships with the app and runs on the computer.
- Closing the window quits the app, unless the web view is on or you choose **Keep running in the tray after closing** in the tray menu.

## Develop

Needs Node 24 and npm. From this folder:

```
npm install
npm run build      # electron-vite build into out/
npm run dist       # also packages dist/NoteSpark-<version>.AppImage
```

`mobile/` holds the phone screens that this app reuses, and `packages/core` the code both share (it is aliased as `@notespark/core`). Run the built app with `npx electron .` (unset `ELECTRON_RUN_AS_NODE` in editors that set it). `NOTESPARK_DIR` points the app at another data folder; `scripts/seed-db.mjs` builds a database from a NoteSpark JSON export.

## Notes for packagers

- Native libraries (SQLite, the ONNX runtime, the vector extension) are unpacked from `app.asar`; the search model goes to `resources/models`.
- Chromium's sandbox needs unprivileged user namespaces. Ubuntu 23.10 and later confine them for programs that have no AppArmor profile, so an AppImage can stop with "No usable sandbox!". `packaging/apparmor/notespark` is a profile of the kind Ubuntu ships for Slack, Discord and VS Code: copy it to `/etc/apparmor.d/` and run `sudo apparmor_parser -r /etc/apparmor.d/notespark`. (A deb installs the setuid sandbox helper instead and does not need it.) `--no-sandbox` also starts the app, but turns the sandbox off. Where the restriction is off, or a profile already allows it, nothing is needed.
