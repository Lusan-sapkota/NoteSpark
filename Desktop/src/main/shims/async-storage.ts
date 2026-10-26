// Settings and small state (what AsyncStorage holds on the phone) in one JSON file, written atomically.
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataDir } from './paths';

let cache: Record<string, string> | null = null;
const file = () => join(dataDir(), 'settings.json');
const load = () => {
  if (!cache) {
    try { cache = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}; } catch { cache = {}; }
  }
  return cache!;
};
const save = () => {
  mkdirSync(dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  renameSync(tmp, file());
};

const AsyncStorage = {
  getItem: async (key: string) => load()[key] ?? null,
  setItem: async (key: string, value: string) => { load()[key] = String(value); save(); },
  removeItem: async (key: string) => { delete load()[key]; save(); },
};
export default AsyncStorage;
