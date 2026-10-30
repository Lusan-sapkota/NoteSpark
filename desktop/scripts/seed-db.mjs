// Builds a database with the phone's schema from a NoteSpark JSON export.
// Usage: node scripts/seed-db.mjs export.json <data dir>/databases/notespark.db (run the app with NOTESPARK_DIR=<data dir>)
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/seed-db.mjs export.json notes.db');
const notes = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(notes)) throw new Error('Not a NoteSpark export');

mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
const db = new Database(output);
// Same tables as mobile/src/storage/database.ts (initDatabase).
db.exec(`
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    isMarkdown INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    isPinned INTEGER NOT NULL DEFAULT 0,
    deletedAt TEXT,
    isArchived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noteId INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    isMarkdown INTEGER NOT NULL,
    savedAt TEXT NOT NULL
  );
  CREATE INDEX note_versions_note ON note_versions (noteId, savedAt);
  CREATE TABLE scratchpad (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL, updatedAt TEXT NOT NULL);
`);
const insert = db.prepare(
  'INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, isPinned, deletedAt, isArchived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
);
const now = new Date().toISOString();
db.transaction(() => {
  for (const n of notes) {
    insert.run(n.title ?? 'Untitled note', n.content ?? '', n.isMarkdown === false || n.isMarkdown === 0 ? 0 : 1,
      n.createdAt ?? now, n.updatedAt ?? n.createdAt ?? now, n.isPinned ? 1 : 0, n.deletedAt ?? null, n.isArchived ? 1 : 0);
  }
})();
console.log(`Seeded ${notes.length} notes into ${output}`);
