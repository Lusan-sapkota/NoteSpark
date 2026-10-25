import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { changesNotes, toNote } from './notes';
import { Note } from '../types';
import { BIN_DAYS, db, dbName, deleteProfileDatabase, forgetProfileKey, getProfileKey, initDatabase, isProfileDatabaseOpen, isProfileEncrypted, openProfileConnection, openProfileDatabase, restoreProfileKey, setProfileEncryption, withDatabaseLock } from './database';

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

// PINs are stored as "salt:sha256(salt + pin)" in SecureStore, one key per profile.
// A copy with the SQLCipher key XOR-wrapped by sha256(salt + ":key:" + pin) is kept in AsyncStorage so
// locked profiles survive an Android backup or phone transfer (which excludes SecureStore) and unlock once
// the person enters their PIN on the new phone.
const pinKey = (id: string) => `profilePin_${id}`;
const pinBackupsKey = 'profilePinBackups';
type PinBackup = { stored: string; wrappedKey?: string };

const hashPin = (salt: string, pin: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, salt + pin);
const xorHex = (a: string, b: string) =>
  Array.from({ length: a.length }, (_, i) => (parseInt(a[i], 16) ^ parseInt(b[i], 16)).toString(16)).join('');

const getPinBackups = async (): Promise<Record<string, PinBackup>> =>
  JSON.parse((await AsyncStorage.getItem(pinBackupsKey)) ?? '{}');

const savePinBackup = async (id: string, entry: PinBackup | null) => {
  const backups = await getPinBackups();
  if (entry) backups[id] = entry;
  else delete backups[id];
  await AsyncStorage.setItem(pinBackupsKey, JSON.stringify(backups));
};

const wrapProfileKey = async (id: string, pin: string, stored: string) => {
  const key = await getProfileKey(id);
  const [salt] = stored.split(':');
  const wrappedKey = key && key.length === 64 ? xorHex(key, await hashPin(`${salt}:key:`, pin)) : undefined;
  await savePinBackup(id, { stored, wrappedKey });
};

const storePin = async (id: string, pin: string | null): Promise<void> => {
  if (pin === null) {
    await SecureStore.deleteItemAsync(pinKey(id));
    await savePinBackup(id, null);
    return;
  }
  const salt = Array.from(Crypto.getRandomBytes(16), b => b.toString(16).padStart(2, '0')).join('');
  const stored = `${salt}:${await hashPin(salt, pin)}`;
  await SecureStore.setItemAsync(pinKey(id), stored);
  await wrapProfileKey(id, pin, stored);
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
  return (await SecureStore.getItemAsync(pinKey(id))) ?? (await getPinBackups())[id]?.stored ?? null;
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
  if (!(await isAuthorized(id, pin))) throw new Error('Invalid profile PIN');
  await openProfileDatabase(id);
  await Promise.all([
    AsyncStorage.setItem(defaultProfileKey, id),
    AsyncStorage.setItem('activeProfile', id),
  ]);
};

// A protected profile asks for its PIN again after NoteSpark has been in the background this long.
// ponytail: locks the screen only; the database stays open (and decrypted) until the app is closed.
const autoLockKey = 'autoLockMinutes';
export const AUTO_LOCK_MINUTES = [0, 1, 5, 15];

export const getAutoLockMinutes = async (): Promise<number> => {
  const stored = await AsyncStorage.getItem(autoLockKey).catch(() => null);
  return stored !== null && AUTO_LOCK_MINUTES.includes(Number(stored)) ? Number(stored) : 1;
};

export const setAutoLockMinutes = (minutes: number) => AsyncStorage.setItem(autoLockKey, String(minutes));

// After MAX_TRIES wrong PINs the profile locks for 30 s, doubling per further miss up to 15 min.
const MAX_TRIES = 5;
const attemptsKey = 'pinAttempts';
type Attempts = Record<string, { failures: number; lockedUntil?: number }>;

const getAttempts = async (): Promise<Attempts> => JSON.parse((await AsyncStorage.getItem(attemptsKey)) ?? '{}');

const saveAttempt = async (id: string, entry: Attempts[string] | null) => {
  const attempts = await getAttempts();
  if (entry) attempts[id] = entry;
  else delete attempts[id];
  await AsyncStorage.setItem(attemptsKey, JSON.stringify(attempts));
};

export const getPinLockout = async (id: string): Promise<number> =>
  Math.max(0, ((await getAttempts())[id]?.lockedUntil ?? 0) - Date.now());

export const wrongPinMessage = async (id: string): Promise<string> => {
  const wait = await getPinLockout(id);
  if (!wait) return 'Enter the four-digit PIN for this profile.';
  const seconds = Math.ceil(wait / 1000);
  return `Too many wrong PINs. Try again in ${seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`}.`;
};

// Only a four-digit attempt counts as a try: screens pass '' just to ask whether a profile has a PIN.
export const verifyProfilePin = async (id: string, pin: string): Promise<boolean> => {
  const stored = await getStoredPin(id);
  if (!stored) return true;
  if (!PIN_PATTERN.test(pin) || (await getPinLockout(id)) > 0) return false;
  const [salt, hash] = stored.split(':');
  if ((await hashPin(salt, pin)) === hash) {
    await saveAttempt(id, null);
    await SecureStore.setItemAsync(pinKey(id), stored);
    const backup = (await getPinBackups())[id];
    if (!(await isProfileEncrypted(id)) && backup?.wrappedKey?.length === 64) {
      const unwrapped = xorHex(backup.wrappedKey, await hashPin(`${salt}:key:`, pin));
      await restoreProfileKey(id, unwrapped);
    } else if (!backup?.wrappedKey) {
      await wrapProfileKey(id, pin, stored);
    }
    return true;
  }
  const failures = ((await getAttempts())[id]?.failures ?? 0) + 1;
  const lockedUntil = failures >= MAX_TRIES ? Date.now() + Math.min(30000 * 2 ** (failures - MAX_TRIES), 900000) : undefined;
  await saveAttempt(id, { failures, lockedUntil });
  return false;
};

// Fingerprint is an extra way to open a protected profile; changing or removing the PIN still needs the PIN.
const biometricKey = 'biometricProfiles';

const getBiometricIds = async (): Promise<string[]> => JSON.parse((await AsyncStorage.getItem(biometricKey)) ?? '[]');

export const usesBiometrics = async (id: string): Promise<boolean> => (await getBiometricIds()).includes(id);

export const setUsesBiometrics = async (id: string, on: boolean): Promise<void> => {
  const ids = (await getBiometricIds()).filter(x => x !== id);
  await AsyncStorage.setItem(biometricKey, JSON.stringify(on ? [...ids, id] : ids));
};

export const canUseBiometrics = async (): Promise<boolean> =>
  (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());

// After a fingerprint check, open/switch/default/delete skip the PIN for a minute (time for a confirm dialog).
let biometricGrant: { id: string; until: number } | null = null;

export const unlockWithBiometrics = async (profile: Profile): Promise<boolean> => {
  if (!(await usesBiometrics(profile.id)) || !(await canUseBiometrics())) return false;
  // After a phone transfer, SecureStore is empty until the PIN is entered once to unwrap the key.
  if (!(await isProfileEncrypted(profile.id)) && (await getPinBackups())[profile.id]?.wrappedKey) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: `Open ${profile.name}`,
    cancelLabel: 'Use PIN',
    disableDeviceFallback: true,
  });
  if (result.success) biometricGrant = { id: profile.id, until: Date.now() + 60000 };
  return result.success;
};

const isAuthorized = async (id: string, pin = ''): Promise<boolean> =>
  (biometricGrant?.id === id && biometricGrant.until > Date.now()) || verifyProfilePin(id, pin);

export const hasProfilePin = async (id: string): Promise<boolean> => Boolean(await getStoredPin(id));

export const switchProfile = async (id: string, pin?: string): Promise<void> => {
  if (!(await isAuthorized(id, pin))) {
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
  if (pin) {
    await storePin(profile.id, pin);
    await encryptAsLocked(profile.id, pin);
  }
  return profile;
};

// Notes are encrypted while a profile has a PIN. A failed conversion is retried at the next start.
const encryptAsLocked = async (id: string, pin?: string) => {
  try {
    // Restored from backup with a wrapped key: already encrypted on disk, waiting for the first PIN unlock.
    if (!(await isProfileEncrypted(id)) && (await getPinBackups())[id]?.wrappedKey) return;
    await setProfileEncryption(id, await hasProfilePin(id));
    if (pin) {
      const stored = await getStoredPin(id);
      if (stored) await wrapProfileKey(id, pin, stored);
    }
  } catch (error) {
    console.warn('Profile encryption change failed:', error);
  }
};

// Startup: also converts profiles whose PIN predates encryption.
export const syncProfileEncryption = async (): Promise<void> => {
  for (const profile of await getStoredProfiles()) await encryptAsLocked(profile.id);
};

// Setting, changing or removing (null) a PIN needs the current one when the profile has one.
export const setProfilePin = async (id: string, pin: string | null, currentPin = ''): Promise<void> => {
  if (pin !== null && !PIN_PATTERN.test(pin)) throw new Error('Profile PIN must be exactly four digits');
  if (!(await verifyProfilePin(id, currentPin))) throw new Error('Invalid profile PIN');
  await storePin(id, pin);
  if (pin === null) await setUsesBiometrics(id, false);
  await encryptAsLocked(id, pin ?? undefined);
};

export const renameProfile = (id: string, name: string): Promise<void> => updateProfile(id, { name });

export const moveProfileToBin = async (id: string, pin = ''): Promise<void> => {
  if ((await getDefaultProfile()).id === id) throw new Error("The default profile can't be deleted");
  if ((await getActiveProfile()).id === id) throw new Error("The open profile can't be deleted");
  if (!(await isAuthorized(id, pin))) throw new Error('Invalid profile PIN');
  await updateProfile(id, { deletedAt: new Date().toISOString() });
};

export const restoreProfile = (id: string): Promise<void> => updateProfile(id, { deletedAt: undefined });

// The file goes first: if it can't be deleted yet (still open), the profile stays listed and a later purge retries.
export const deleteProfileForever = async (id: string): Promise<void> => {
  await deleteProfileDatabase(id);
  await saveProfiles((await getStoredProfiles()).filter(p => p.id !== id));
  await storePin(id, null);
  await saveAttempt(id, null);
  await setUsesBiometrics(id, false);
  await forgetProfileKey(id);
};

export const purgeProfileBin = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - BIN_DAYS * 86400000).toISOString();
  for (const p of await getBinnedProfiles()) {
    if (p.deletedAt! < cutoff) await deleteProfileForever(p.id).catch(error => console.warn('Profile purge will retry:', error));
  }
};

// Forgot PIN: erase the profile, since a PIN can't be recovered. Another profile (or a new Personal one) takes
// over as default and open profile; returns it.
export const eraseForgottenProfile = async (id: string): Promise<Profile> => {
  const next = (await getProfiles()).find(p => p.id !== id) ?? (await addProfile('Personal'));
  // An open database can't be deleted. This only happens at startup, before any profile is shown.
  if (isProfileDatabaseOpen(id) && !(await hasProfilePin(next.id))) await openProfileDatabase(next.id);
  if ((await getDefaultProfile()).id === id) await AsyncStorage.setItem(defaultProfileKey, next.id);
  if ((await getActiveProfile()).id === id) await AsyncStorage.setItem('activeProfile', next.id);
  await deleteProfileForever(id);
  return next;
};

// Reads another profile's notes without switching to it.
export const readProfileNotes = (id: string): Promise<Note[]> =>
  withDatabaseLock(async () => {
    const db = await openProfileConnection(id, { useNewConnection: true });
    try {
      return (await db.getAllAsync('SELECT * FROM notes WHERE deletedAt IS NULL ORDER BY updatedAt DESC')).map(toNote);
    } finally {
      await db.closeAsync();
    }
  });

// Moves notes (and their version history) from the open profile to another profile.
// Writes to the target profile first, so a failure leaves the source notes untouched. Returns an undo callback.
export const transferNotesToProfile = changesNotes(
  async (notes: Note[], targetProfileId: string, pin?: string): Promise<() => Promise<void>> => {
    if (!(await isAuthorized(targetProfileId, pin))) throw new Error('Invalid profile PIN');
    if (isProfileDatabaseOpen(targetProfileId)) throw new Error('Notes are already in this profile');
    const versionsByNote = new Map<number, { title: string; content: string; isMarkdown: number; savedAt: string }[]>();
    for (const note of notes) {
      versionsByNote.set(
        note.id,
        await db.getAllAsync('SELECT title, content, isMarkdown, savedAt FROM note_versions WHERE noteId = ? ORDER BY id ASC', [note.id])
      );
    }
    const insertedIds: number[] = [];
    await withDatabaseLock(async () => {
      const targetDb = await openProfileConnection(targetProfileId, { useNewConnection: true });
      try {
        await initDatabase(targetDb);
        await targetDb.withExclusiveTransactionAsync(async txn => {
          for (const note of notes) {
            const res = await txn.runAsync(
              'INSERT INTO notes (title, content, isMarkdown, createdAt, updatedAt, isPinned, isArchived) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [note.title, note.content, note.isMarkdown ? 1 : 0, note.createdAt, note.updatedAt, note.isPinned ? 1 : 0, note.isArchived ? 1 : 0]
            );
            const newId = res.lastInsertRowId;
            insertedIds.push(newId);
            for (const v of versionsByNote.get(note.id) ?? []) {
              await txn.runAsync(
                'INSERT INTO note_versions (noteId, title, content, isMarkdown, savedAt) VALUES (?, ?, ?, ?, ?)',
                [newId, v.title, v.content, v.isMarkdown ? 1 : 0, v.savedAt]
              );
            }
          }
        });
      } finally {
        await targetDb.closeAsync();
      }
      for (const note of notes) {
        await db.runAsync('DELETE FROM notes WHERE id = ?', [note.id]);
        await db.runAsync('DELETE FROM note_versions WHERE noteId = ?', [note.id]);
      }
    });
    return changesNotes(async () => {
      await withDatabaseLock(async () => {
        for (const note of notes) {
          const res = await db.runAsync(
            'INSERT INTO notes (id, title, content, isMarkdown, createdAt, updatedAt, isPinned, isArchived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [note.id, note.title, note.content, note.isMarkdown ? 1 : 0, note.createdAt, note.updatedAt, note.isPinned ? 1 : 0, note.isArchived ? 1 : 0]
          );
          const restoredId = res.lastInsertRowId || note.id;
          for (const v of versionsByNote.get(note.id) ?? []) {
            await db.runAsync(
              'INSERT INTO note_versions (noteId, title, content, isMarkdown, savedAt) VALUES (?, ?, ?, ?, ?)',
              [restoredId, v.title, v.content, v.isMarkdown ? 1 : 0, v.savedAt]
            );
          }
        }
        const targetDb = await openProfileConnection(targetProfileId, { useNewConnection: true });
        try {
          await targetDb.withExclusiveTransactionAsync(async txn => {
            for (const id of insertedIds) {
              await txn.runAsync('DELETE FROM notes WHERE id = ?', [id]);
              await txn.runAsync('DELETE FROM note_versions WHERE noteId = ?', [id]);
            }
          });
        } finally {
          await targetDb.closeAsync();
        }
      });
    });
  }
);

// Throws if any profile can't be read, so pruning is skipped instead of deleting images still in use.
export const getAllProfilesNoteContents = async (): Promise<string[]> => {
  const contents: string[] = [];
  for (const profile of await getStoredProfiles()) {
    await withDatabaseLock(async () => {
      const db = await openProfileConnection(profile.id, { useNewConnection: true });
      try {
        const rows = await db.getAllAsync<{ content: string }>('SELECT content FROM notes');
        // Versions can be restored, so their images count as used too (older databases may lack the table).
        const versions = await db.getAllAsync<{ content: string }>('SELECT content FROM note_versions').catch(() => []);
        [...rows, ...versions].forEach(r => contents.push(String(r.content ?? '')));
      } finally {
        await db.closeAsync();
      }
    });
  }
  return contents;
};
