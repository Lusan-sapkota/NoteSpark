# Changelog

All notable changes to NoteSpark will be documented in this file.

## [Unreleased]

### Added

- Sync covers the scratchpad, version history, tidy-up choices, profile name and imported-history marks; an optional setting syncs preferences too
- Live sync status in the Android notification and the desktop tray; the Sync screen notes that background sync pauses after about 5 hours
- Tasks: long press to select several, mark done, move to another profile; note menus move a note to a profile by name; locked profiles ask for their PIN or fingerprint
- A Material time picker for task reminders and Lock again when away
- Desktop editor draws headings, bold, italic and strikethrough, hiding the marks in Plain text
- Tap beside the text in the editor and scratchpad to put the cursor at the end of that line

### Changed

- A phone turned sideways keeps the full-width list; two panes need a 600 dp shortest side
- The scratchpad asks before clearing

### Fixed

- The keyboard no longer opens and closes after several lines in the editor and scratchpad, and Enter no longer flickers
- No full-screen typing box in landscape
- The scratchpad's first sync keeps text written on this device

## [1.2.0] - 2026-11-07

### Added

- Pin and Archive buttons at the top of the editor; leaving a note still saves it, so the Save button is gone
- A formatting bar (the A button): headings, bold, italic, strikethrough, bullets, links and clear formatting, in plain text and Markdown notes
- Note colours (twelve, or your own hex colour) and backgrounds (twenty patterns, or your own picture), synced with the note; text keeps its contrast on all of them
- A three-dots menu in the editor: make a copy, send, find in note, labels and move to bin
- A floating editor toolbar with the same outline as the Plain text and Markdown buttons

### Fixed

- Home swipe: right shows Archive (yellow) and archives, left shows Move to bin (red); scrolling no longer sticks
- Rotation is allowed, and native libraries support devices with 16 KB memory pages
- A telemetry component in onnxruntime is blocked at build time

## [1.0.0] - 2025-07-13

### Added

- Initial public release of NoteSpark!
- Create, edit, and delete notes (Markdown & plain text)
- Pin notes to always keep them at the top
- Sort notes by last edited or created
- Advanced search and filter by title, content, or type
- Attach images to notes (file links)
- Auto-detect and highlight links and media
- Import/export notes for backup and restore
- Introduced import/export history, allowing users to view past actions and download records as PDF or clear it
- Beautiful UI with dark mode support
- Fully offline, privacy-first (no accounts, no ads)
- Copy/share notes with other apps
- Notification system for reminders and important notes
- Open source (GPLv3)
- Blazing fast performance, even with hundreds of notes
- Clean navigation and easy access to all features

---

Older changes will be added here as the app evolves.
