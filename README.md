<div align="center">
  <img src="./mobile/assets/logo/round.svg" alt="NoteSpark logo" width="120" height="120" />
</div>

# NoteSpark

Private notes that stay on your devices. No account, no cloud, no ads, no tracking.

**[Download](https://notespark.lusansapkota.com.np/#get)** · [Help](https://notespark.lusansapkota.com.np/help.html) · [Changelog](https://notespark.lusansapkota.com.np/changelog.html) · [Privacy policy](https://notespark.lusansapkota.com.np/privacy.html)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./web/assets/screens/home-dark.webp" />
    <img src="./web/assets/screens/home-light.webp" alt="The NoteSpark home screen on a phone, with pinned notes and tag filters" width="190" />
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./web/assets/screens/note-dark.webp" />
    <img src="./web/assets/screens/note-light.webp" alt="A note with tasks and due dates" width="190" />
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./web/assets/screens/tasks-dark.webp" />
    <img src="./web/assets/screens/tasks-light.webp" alt="Tasks from every note, by due date" width="190" />
  </picture>
</p>

## What it does

- **Write** in plain text or Markdown, with version history and a scratchpad.
- **Tasks inside notes:** start a line with `- [ ]`, add `due:2026-11-01`, and see every open task on one screen.
- **Find a note by what it means**, on your device, with no internet.
- **Private:** PIN-locked profiles, encrypted on your device, no analytics or update checks.
- **Never trapped:** export as Markdown, back up to a folder, restore from a file.
- **Optional sync** between your own devices, on your own network only.

## Get it

Android, Windows, macOS and Linux downloads, the stores and the install commands are all on the **[website](https://notespark.lusansapkota.com.np/#get)**, which is always kept up to date. Every [GitHub release](https://github.com/Lusan-sapkota/NoteSpark/releases) has a `SHA256SUMS` file.

## Repository

| Folder | What it is |
|---|---|
| [`mobile/`](./mobile) | The Android app (Expo, React Native, TypeScript, Material 3) |
| [`desktop/`](./desktop) | The desktop app (Electron), reusing the phone's screens and theme |
| [`packages/`](./packages) | Code both apps share: translations, storage, the sync protocol |
| [`docker/`](./docker) | The self-hosted hub (planned) |
| [`web/`](./web) | The website, plain HTML and CSS with no build step |

## Build from source

The Android app uses native modules, so use a development or release build.

```bash
cd mobile && npm install
npx expo run:android          # a device or emulator, with the Android SDK installed
npx tsc --noEmit              # type check

cd ../desktop && npm install && npm run build
npx electron .                # unset ELECTRON_RUN_AS_NODE if your editor sets it

cd ../packages/core && npm test
```

## License

[GPLv3](./LICENSE). Made and maintained by [Lusan Sapkota](https://github.com/Lusan-sapkota). Questions: [contact@lusansapkota.com.np](mailto:contact@lusansapkota.com.np).
