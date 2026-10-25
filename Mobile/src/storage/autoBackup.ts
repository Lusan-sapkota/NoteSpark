// Automatic backups to a folder the person picks (Android's folder picker, so no storage permission).
// Runs when the app opens or comes back to the front and a backup is due; there's no background job.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAsync, StorageAccessFramework as SAF, writeAsStringAsync } from 'expo-file-system/legacy';
import { getProfiles, hasProfilePin, readProfileNotes } from './profiles';
import { notesToJson } from '../utils/exportNotes';

export interface AutoBackupSettings {
  folderUri: string;
  frequency: 'daily' | 'weekly';
  // Protected profiles are skipped unless the person agreed that their backups are readable files.
  includeProtected: boolean;
  lastRun?: string;
  lastError?: string;
}

const KEY = 'autoBackup';
export const BACKUPS_KEPT = 5;

export const getAutoBackup = async (): Promise<AutoBackupSettings | null> => {
  const stored = await AsyncStorage.getItem(KEY);
  return stored ? (JSON.parse(stored) as AutoBackupSettings) : null;
};

export const setAutoBackup = (settings: AutoBackupSettings | null) =>
  settings ? AsyncStorage.setItem(KEY, JSON.stringify(settings)) : AsyncStorage.removeItem(KEY);

export const pickBackupFolder = async (): Promise<string | null> => {
  const result = await SAF.requestDirectoryPermissionsAsync();
  return result.granted ? result.directoryUri : null;
};

// The folder's name for display, from a tree URI like content://…/tree/primary%3ADocuments%2FNoteSpark.
export const folderName = (uri: string) => decodeURIComponent(uri).split(/[:/]/).filter(Boolean).pop() ?? 'Backup folder';

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const safeName = (name: string) => name.replace(/[^\p{L}\p{N} _]/gu, '').trim().slice(0, 40) || 'profile';

// notespark-<name>-<id>-<date>.json, maybe with Android's " (1)". Matching by id keeps pruning right after a rename.
const backupPattern = (id: string) => new RegExp(`^notespark-.*-${id.replace(/[^a-z0-9]/gi, '')}-(\\d{4}-\\d{2}-\\d{2}-\\d{4})(?: \\(\\d+\\))?(?:\\.json)?$`);
const fileNameOf = (uri: string) => decodeURIComponent(uri).split('/').pop() ?? '';

// One file per profile, then deletes that profile's files beyond BACKUPS_KEPT. Returns how many it backed up and any profile error.
export const runBackup = async (settings: AutoBackupSettings): Promise<{ count: number; error?: string }> => {
  const existing = await SAF.readDirectoryAsync(settings.folderUri);
  const now = stamp(new Date());
  let count = 0;
  let lastError: string | undefined;
  for (const profile of await getProfiles()) {
    if (!settings.includeProtected && (await hasProfilePin(profile.id))) continue;
    try {
      const notes = await readProfileNotes(profile.id);
      const uri = await SAF.createFileAsync(settings.folderUri, `notespark-${safeName(profile.name)}-${profile.id}-${now}`, 'application/json');
      await writeAsStringAsync(uri, notesToJson(notes));
      count++;
      const pattern = backupPattern(profile.id);
      const old = existing
        .map(uri => ({ uri, date: pattern.exec(fileNameOf(uri))?.[1] }))
        .filter((f): f is { uri: string; date: string } => !!f.date)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(BACKUPS_KEPT - 1);
      for (const f of old) await deleteAsync(f.uri, { idempotent: true });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (count === 0 && lastError) throw new Error(lastError);
  return { count, error: lastError };
};

let running = false;

// lastRun moves when at least one profile is backed up, so a single broken profile doesn't rotate out the others on every open.
export const runAutoBackupIfDue = async (): Promise<void> => {
  const settings = await getAutoBackup();
  if (!settings || running) return;
  const days = settings.frequency === 'daily' ? 1 : 7;
  if (settings.lastRun && Date.now() - Date.parse(settings.lastRun) < days * 86400000 - 3600000) return;
  running = true;
  try {
    const { error } = await runBackup(settings);
    await setAutoBackup({ ...settings, lastRun: new Date().toISOString(), lastError: error });
  } catch (error) {
    await setAutoBackup({ ...settings, lastError: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
};
