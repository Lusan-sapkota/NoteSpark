// The file calls the phone's storage code makes: moving and deleting database files, and writing backups into a folder.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, dialog } from 'electron';

const path = (uri: string) => (uri.startsWith('file://') ? fileURLToPath(uri) : uri);
export const getInfoAsync = async (uri: string) => ({ exists: existsSync(path(uri)) });
export const deleteAsync = async (uri: string, _options?: { idempotent?: boolean }) => rmSync(path(uri), { force: true });
export const moveAsync = async ({ from, to }: { from: string; to: string }) => renameSync(path(from), path(to));
export const writeAsStringAsync = async (uri: string, text: string) => writeFileSync(path(uri), text, { mode: 0o600 });

// Android's folder picker (SAF) becomes the system folder dialog; a "folder address" is a plain path.
export const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: async () => {
    const options = { properties: ['openDirectory' as const, 'createDirectory' as const], title: 'Choose a folder for backups' };
    const window = BrowserWindow.getFocusedWindow();
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? { granted: false as const } : { granted: true as const, directoryUri: result.filePaths[0] };
  },
  readDirectoryAsync: async (dir: string) => readdirSync(dir).map(name => join(dir, name)),
  createFileAsync: async (dir: string, name: string, _mime: string) => {
    mkdirSync(dir, { recursive: true });
    // The phone's picker adds the extension from the type, and " (1)", " (2)" when the name is taken.
    const base = name.replace(/[\\/]/g, '-');
    let file = join(dir, `${base}.json`);
    for (let i = 1; existsSync(file); i++) file = join(dir, `${base} (${i}).json`);
    return file;
  },
};
