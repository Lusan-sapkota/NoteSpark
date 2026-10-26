// The file calls the phone's storage code makes: moving and deleting database files, attachment storage, and backups.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dataDir, electron } from './paths';

const path = (uri: string) => (uri.startsWith('file://') ? fileURLToPath(uri) : uri);

export const documentDirectory = `${pathToFileURL(dataDir()).href}/`;
export const cacheDirectory = `${pathToFileURL(join(dataDir(), 'cache')).href}/`;

export const EncodingType = {
  UTF8: 'utf8',
  Base64: 'base64',
} as const;

export const getInfoAsync = async (uri: string) => {
  const p = path(uri);
  if (!existsSync(p)) {
    return { exists: false as const, isDirectory: false, size: 0, modificationTime: 0, uri };
  }
  const st = statSync(p);
  return {
    exists: true as const,
    isDirectory: st.isDirectory(),
    size: st.size,
    modificationTime: st.mtimeMs / 1000,
    uri,
  };
};

export const makeDirectoryAsync = async (uri: string, options?: { intermediates?: boolean }) => {
  mkdirSync(path(uri), { recursive: options?.intermediates ?? false });
};

export const readDirectoryAsync = async (uri: string): Promise<string[]> => readdirSync(path(uri));

export const deleteAsync = async (uri: string, options?: { idempotent?: boolean }) => {
  rmSync(path(uri), { force: options?.idempotent ?? true, recursive: true });
};

let failNextMove = false;
export const setFailNextMove = (fail: boolean) => {
  failNextMove = fail;
};

export const moveAsync = async ({ from, to }: { from: string; to: string }) => {
  if (failNextMove) {
    failNextMove = false;
    throw new Error('simulated disk crash during rename');
  }
  const dst = path(to);
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(path(from), dst);
};

export const copyAsync = async ({ from, to }: { from: string; to: string }) => {
  const dst = path(to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(path(from), dst);
};

export const readAsStringAsync = async (uri: string, options?: { encoding?: string }) => {
  const p = path(uri);
  if (options?.encoding === EncodingType.Base64) {
    return readFileSync(p).toString('base64');
  }
  return readFileSync(p, 'utf8');
};

export const writeAsStringAsync = async (uri: string, text: string, options?: { encoding?: string }) => {
  const p = path(uri);
  mkdirSync(dirname(p), { recursive: true });
  if (options?.encoding === EncodingType.Base64) {
    writeFileSync(p, Buffer.from(text, 'base64'), { mode: 0o600 });
    return;
  }
  writeFileSync(p, text, { mode: 0o600 });
};

// Android's folder picker (SAF) becomes the system folder dialog; a "folder address" is a plain path.
export const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: async () => {
    const { BrowserWindow, dialog } = electron();
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
