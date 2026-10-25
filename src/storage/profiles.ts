import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { dbName, initDatabase, openProfileDatabase } from './database';

export interface Profile {
  id: string;
  name: string;
}

const defaultProfile: Profile = { id: 'default', name: 'Personal' };
const profilePinsKey = 'profilePins';
const defaultProfileKey = 'defaultProfile';
const PIN_PATTERN = /^\d{4}$/;

export const getProfiles = async (): Promise<Profile[]> => {
  const stored = await AsyncStorage.getItem('profiles');
  const list = stored ? (JSON.parse(stored) as Profile[]) : [];
  return list.length ? list : [defaultProfile];
};

const saveProfiles = (profiles: Profile[]) => AsyncStorage.setItem('profiles', JSON.stringify(profiles));

const getProfilePins = async (): Promise<Record<string, string>> => {
  const stored = await AsyncStorage.getItem(profilePinsKey);
  return stored ? (JSON.parse(stored) as Record<string, string>) : {};
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
  const pins = await getProfilePins();
  if (!pins[id]) return true;
  return PIN_PATTERN.test(pin) && pins[id] === pin;
};

export const hasProfilePin = async (id: string): Promise<boolean> => Boolean((await getProfilePins())[id]);

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
  const profiles = await getProfiles();
  await saveProfiles([...profiles, profile]);
  if (!(await AsyncStorage.getItem(defaultProfileKey))) {
    await AsyncStorage.setItem(defaultProfileKey, profiles[0].id);
  }
  if (pin) {
    const pins = await getProfilePins();
    await AsyncStorage.setItem(profilePinsKey, JSON.stringify({ ...pins, [profile.id]: pin }));
  }
  return profile;
};

export const setProfilePin = async (id: string, pin: string | null): Promise<void> => {
  if (pin !== null && !PIN_PATTERN.test(pin)) throw new Error('Profile PIN must be exactly four digits');
  const pins = await getProfilePins();
  if (pin === null) delete pins[id];
  else pins[id] = pin;
  await AsyncStorage.setItem(profilePinsKey, JSON.stringify(pins));
};

export const renameProfile = async (id: string, name: string): Promise<void> => {
  await saveProfiles((await getProfiles()).map(p => (p.id === id ? { ...p, name } : p)));
};

export const deleteProfile = async (id: string): Promise<void> => {
  const remaining = (await getProfiles()).filter(p => p.id !== id);
  await saveProfiles(remaining);
  if ((await AsyncStorage.getItem(defaultProfileKey)) === id && remaining.length) {
    await AsyncStorage.setItem(defaultProfileKey, remaining[0].id);
  }
  const pins = await getProfilePins();
  delete pins[id];
  await AsyncStorage.setItem(profilePinsKey, JSON.stringify(pins));
  await SQLite.deleteDatabaseAsync(dbName(id)).catch(() => {});
};

// Throws if any profile can't be read, so pruning is skipped instead of deleting images still in use.
export const getAllProfilesNoteContents = async (): Promise<string[]> => {
  const contents: string[] = [];
  for (const profile of await getProfiles()) {
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
