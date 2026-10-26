import { createRequire } from 'node:module';
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
export const databaseDir = () => join(dataDir(), 'databases');
