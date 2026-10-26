// Keys for protected profiles, encrypted with the operating system's keyring (Electron safeStorage).
// ponytail: needs a working keyring (libsecret / KWallet); without one it refuses to store a key instead of
// writing it in plain text. Reviewed again in phase 4 with the profile screens.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import { dataDir } from './paths';

const file = () => join(dataDir(), 'secure.json');
const read = (): Record<string, string> => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}; } catch { return {}; } };
const write = (data: Record<string, string>) => {
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(`${file()}.tmp`, JSON.stringify(data), { mode: 0o600 });
  renameSync(`${file()}.tmp`, file());
};

export const getItemAsync = async (key: string) => {
  const value = read()[key];
  return value === undefined ? null : safeStorage.decryptString(Buffer.from(value, 'base64'));
};
export const setItemAsync = async (key: string, value: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('No system keyring is available to protect the key');
  write({ ...read(), [key]: safeStorage.encryptString(value).toString('base64') });
};
export const deleteItemAsync = async (key: string) => {
  const data = read();
  delete data[key];
  write(data);
};
