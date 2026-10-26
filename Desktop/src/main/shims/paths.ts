import { join } from 'node:path';
import { app } from 'electron';

// Where the desktop keeps its data. NOTESPARK_DIR points it somewhere else (tests, a seeded database).
export const dataDir = () => process.env.NOTESPARK_DIR ?? app.getPath('userData');
export const databaseDir = () => join(dataDir(), 'databases');
