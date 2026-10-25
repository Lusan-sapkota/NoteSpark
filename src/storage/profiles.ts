import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { dbName, initDatabase, openProfileDatabase } from './database';

export interface Profile {
  id: string;
  name: string;
}

const defaultProfile: Profile = { id: 'default', name: 'Personal' };

export const getProfiles = async (): Promise<Profile[]> => {
  const stored = await AsyncStorage.getItem('profiles');
  const list = stored ? (JSON.parse(stored) as Profile[]) : [];
  return list.length ? list : [defaultProfile];
};

const saveProfiles = (profiles: Profile[]) => AsyncStorage.setItem('profiles', JSON.stringify(profiles));

export const getActiveProfile = async (): Promise<Profile> => {
  const [profiles, id] = await Promise.all([getProfiles(), AsyncStorage.getItem('activeProfile')]);
  return profiles.find(p => p.id === id) ?? profiles[0];
};

export const switchProfile = async (id: string): Promise<void> => {
  await openProfileDatabase(id);
  await AsyncStorage.setItem('activeProfile', id);
};

export const addProfile = async (name: string): Promise<Profile> => {
  const profile = { id: Date.now().toString(36), name };
  const db = await SQLite.openDatabaseAsync(dbName(profile.id));
  try {
    await initDatabase(db);
  } finally {
    await db.closeAsync();
  }
  await saveProfiles([...(await getProfiles()), profile]);
  return profile;
};

export const renameProfile = async (id: string, name: string): Promise<void> => {
  await saveProfiles((await getProfiles()).map(p => (p.id === id ? { ...p, name } : p)));
};

export const deleteProfile = async (id: string): Promise<void> => {
  await saveProfiles((await getProfiles()).filter(p => p.id !== id));
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
