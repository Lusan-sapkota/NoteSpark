import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { toNote } from './notes';
import { Note } from '../types';
import { BIN_DAYS, dbName, initDatabase, isProfileDatabaseOpen, openProfileDatabase } from './database';

export interface Profile {
  id: string;
  name: string;
  // Set while the profile is in the bin; its database is kept until BIN_DAYS later.
  deletedAt?: string;
}

const defaultProfile: Profile = { id: 'default', name: 'Personal' };
const defaultProfileKey = 'defaultProfile';
const PIN_PATTERN = /^\d{4}$/;

// Every stored profile, binned ones included.
const getStoredProfiles = async (): Promise<Profile[]> => {
  const stored = await AsyncStorage.getItem('profiles');
  const list = stored ? (JSON.parse(stored) as Profile[]) : [];
  return list.length ? list : [defaultProfile];
};

export const getProfiles = async (): Promise<Profile[]> => (await getStoredProfiles()).filter(p => !p.deletedAt);

export const getBinnedProfiles = async (): Promise<Profile[]> => (await getStoredProfiles()).filter(p => p.deletedAt);

const saveProfiles = (profiles: Profile[]) => AsyncStorage.setItem('profiles', JSON.stringify(profiles));

const updateProfile = async (id: string, change: Partial<Profile>) =>
  saveProfiles((await getStoredProfiles()).map(p => (p.id === id ? { ...p, ...change } : p)));

// PINs are kept as "salt:sha256(salt + pin)" in SecureStore (Android Keystore), one key per profile.
// A four-digit PIN is a lock on the screen, not encryption: the notes databases themselves aren't encrypted.
const pinKey = (id: string) => `profilePin_${id}`;
const hashPin = (salt: string, pin: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, salt + pin);

const storePin = async (id: string, pin: string | null): Promise<void> => {
  if (pin === null) return SecureStore.deleteItemAsync(pinKey(id));
  const salt = Array.from(Crypto.getRandomBytes(16), b => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(pinKey(id), `${salt}:${await hashPin(salt, pin)}`);
};

// Earlier builds kept plain PINs in AsyncStorage under profilePins; move them over once.
let pinsMigrated: Promise<void> | null = null;
const migratePins = () =>
  (pinsMigrated ??= (async () => {
    const stored = await AsyncStorage.getItem('profilePins');
    if (!stored) return;
    for (const [id, pin] of Object.entries(JSON.parse(stored) as Record<string, string>)) await storePin(id, pin);
    await AsyncStorage.removeItem('profilePins');
  })().catch(error => {
    pinsMigrated = null;
    throw error;
  }));

const getStoredPin = async (id: string): Promise<string | null> => {
  await migratePins();
  return SecureStore.getItemAsync(pinKey(id));
};

export const getActiveProfile = async (): Promise<Profile> => {
  const [profiles, id] = await Promise.all([getProfiles(), AsyncStorage.getItem('activeProfile')]);
  return profiles.find(p => p.id === id) ?? profiles[0];
};

export const getDefaultProfile = async (): Promise<Profile> => {
  const [profiles, id] = await Promise.all([getProfiles(), AsyncStorage.getItem(defaultProfileKey)]);
  return profiles.find(p => p.id === id) ?? profiles[0];
};

export const setDefaultProfile = async (id: string, pin?: string): Promise<void> => {
  if (!(await verifyProfilePin(id, pin ?? ''))) throw new Error('Invalid profile PIN');
  await openProfileDatabase(id);
  await Promise.all([
    AsyncStorage.setItem(defaultProfileKey, id),
    AsyncStorage.setItem('activeProfile', id),
  ]);
};

export const verifyProfilePin = async (id: string, pin: string): Promise<boolean> => {
  const stored = await getStoredPin(id);
  if (!stored) return true;
  if (!PIN_PATTERN.test(pin)) return false;
  const [salt, hash] = stored.split(':');
  return (await hashPin(salt, pin)) === hash;
};

export const hasProfilePin = async (id: string): Promise<boolean> => Boolean(await getStoredPin(id));

export const switchProfile = async (id: string, pin?: string): Promise<void> => {
  if (!(await verifyProfilePin(id, pin ?? ''))) {
    throw new Error('Invalid profile PIN');
  }
  await openProfileDatabase(id);
  await AsyncStorage.setItem('activeProfile', id);
};

export const addProfile = async (name: string, pin?: string): Promise<Profile> => {
  if (pin && !PIN_PATTERN.test(pin)) throw new Error('Profile PIN must be exactly four digits');
  const profile = { id: Date.now().toString(36), name };
  const db = await SQLite.openDatabaseAsync(dbName(profile.id));
  try {
    await initDatabase(db);
  } finally {
    await db.closeAsync();
  }
  const firstId = (await getProfiles())[0].id;
  await saveProfiles([...(await getStoredProfiles()), profile]);
  if (!(await AsyncStorage.getItem(defaultProfileKey))) {
    await AsyncStorage.setItem(defaultProfileKey, firstId);
  }
  if (pin) await storePin(profile.id, pin);
  return profile;
};

// Setting, changing or removing (null) a PIN needs the current one when the profile has one.
export const setProfilePin = async (id: string, pin: string | null, currentPin = ''): Promise<void> => {
  if (pin !== null && !PIN_PATTERN.test(pin)) throw new Error('Profile PIN must be exactly four digits');
  if (!(await verifyProfilePin(id, currentPin))) throw new Error('Invalid profile PIN');
  await storePin(id, pin);
};

export const renameProfile = (id: string, name: string): Promise<void> => updateProfile(id, { name });

export const moveProfileToBin = async (id: string, pin = ''): Promise<void> => {
  if ((await getDefaultProfile()).id === id) throw new Error("The default profile can't be deleted");
  if ((await getActiveProfile()).id === id) throw new Error("The open profile can't be deleted");
  if (!(await verifyProfilePin(id, pin))) throw new Error('Invalid profile PIN');
  await updateProfile(id, { deletedAt: new Date().toISOString() });
};

export const restoreProfile = (id: string): Promise<void> => updateProfile(id, { deletedAt: undefined });

export const deleteProfileForever = async (id: string): Promise<void> => {
  await saveProfiles((await getStoredProfiles()).filter(p => p.id !== id));
  await storePin(id, null);
  await SQLite.deleteDatabaseAsync(dbName(id)).catch(() => {});
};

// Run at startup, like the notes bin purge in initDatabase.
export const purgeProfileBin = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - BIN_DAYS * 86400000).toISOString();
  for (const p of await getBinnedProfiles()) {
    if (p.deletedAt! < cutoff) await deleteProfileForever(p.id);
  }
};

// Forgot PIN: a PIN can't be recovered, so the profile and its notes are erased instead. Another profile
// takes over as default and open profile (a new Personal one if this was the only one). Returns that profile.
export const eraseForgottenProfile = async (id: string): Promise<Profile> => {
  const next = (await getProfiles()).find(p => p.id !== id) ?? (await addProfile('Personal'));
  // An open database can't be deleted. This only happens at startup, before any profile is shown.
  if (isProfileDatabaseOpen(id)) await openProfileDatabase(next.id);
  if ((await getDefaultProfile()).id === id) await AsyncStorage.setItem(defaultProfileKey, next.id);
  if ((await getActiveProfile()).id === id) await AsyncStorage.setItem('activeProfile', next.id);
  await deleteProfileForever(id);
  return next;
};

// Notes not in the bin from any profile's database, without switching to it (automatic backups).
export const readProfileNotes = async (id: string): Promise<Note[]> => {
  const db = await SQLite.openDatabaseAsync(dbName(id));
  try {
    return (await db.getAllAsync('SELECT * FROM notes WHERE deletedAt IS NULL ORDER BY updatedAt DESC')).map(toNote);
  } finally {
    await db.closeAsync();
  }
};

// Throws if any profile can't be read, so pruning is skipped instead of deleting images still in use.
export const getAllProfilesNoteContents = async (): Promise<string[]> => {
  const contents: string[] = [];
  for (const profile of await getStoredProfiles()) {
    const db = await SQLite.openDatabaseAsync(dbName(profile.id));
    try {
      const rows = await db.getAllAsync<{ content: string }>('SELECT content FROM notes');
      rows.forEach(r => contents.push(String(r.content ?? '')));
    } finally {
      await db.closeAsync();
    }
  }
  return contents;
};
