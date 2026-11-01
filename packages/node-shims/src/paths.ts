import { createRequire } from 'node:module';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// Electron is loaded lazily, only inside the desktop.
const nodeRequire = createRequire(typeof __filename === 'string' ? __filename : join(process.cwd(), 'noop.js'));
export const electron = (): typeof import('electron') => {
  if (!process.versions.electron) throw new Error('Electron is not available outside the desktop app');
  return nodeRequire('electron');
};
export const requireFromHere = nodeRequire;

// Where the app keeps its data. NOTESPARK_DIR points it somewhere else (tests, a seeded database, Docker).
export const dataDir = () => {
  if (process.env.NOTESPARK_DIR) return process.env.NOTESPARK_DIR;
  return electron().app.getPath('userData');
};
// Not "databases": Chromium deletes a folder of that name in its profile (old WebSQL storage) at startup, which wiped the notes.
// Notes kept in "databases" by earlier versions are moved over once.
export const databaseDir = () => {
  const dir = join(dataDir(), 'notes-data');
  const old = join(dataDir(), 'databases');
  if (!existsSync(dir) && existsSync(old)) {
    try { renameSync(old, dir); } catch { /* the old folder stays; a new one is made */ }
  }
  return dir;
};
