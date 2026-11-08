import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SettingEntry } from '@notespark/sync';
import { addSettings, getSettingsData } from '../storage/notes';

// Preferences that follow the person between devices when "Sync settings" is on (they ride in the synced profile's catalog).
// Never listed: PIN, fingerprint, auto-lock, backups, the web images switch, anything about this device or the network.
const SWITCH = 'syncSettings';
const STAMPS = 'syncSettingsStamps';
const SYNCED: Record<string, string> = {
  theme: 'themePreference',
  language: 'language',
  reminderTime: 'reminderTime',
  searchType: 'searchType',
  shareTarget: 'shareTarget',
  startScreen: 'startScreen',
  liveRelated: 'liveRelatedOn',
  rediscoverOff: 'rediscoverOff',
};

export const isSyncSettingsOn = async () => (await AsyncStorage.getItem(SWITCH).catch(() => null)) === '1';
export const setSyncSettingsOn = (on: boolean) => AsyncStorage.setItem(SWITCH, on ? '1' : '0');

type Stamps = Record<string, { at: number; value: string }>;

// Newest change wins, per setting. A value changed here since the last pass goes out; a newer one from another device is
// kept here. The first pass on a device adopts what the others already chose, and only sends what nobody has set.
// Returns true when a value here changed (the theme and language apply at the next start).
export const syncSettings = async (): Promise<boolean> => {
  if (!(await isSyncSettingsOn())) return false;
  const { synced, settings } = await getSettingsData();
  if (!synced) return false;
  const remote = new Map(settings.map(s => [s.name, s]));
  let stamps: Stamps = {};
  try { stamps = JSON.parse((await AsyncStorage.getItem(STAMPS)) ?? '{}'); } catch { /* start over */ }
  const push: SettingEntry[] = [];
  let changed = false;
  for (const [name, key] of Object.entries(SYNCED)) {
    const local = await AsyncStorage.getItem(key).catch(() => null);
    const seen = stamps[name];
    const r = remote.get(name);
    if (seen ? local !== null && local !== seen.value : !r && local !== null) {
      const at = Date.now();
      push.push({ name, value: local!, at });
      stamps[name] = { at, value: local! };
    } else if (r && r.at > (seen?.at ?? -1)) {
      if (r.value !== local) { await AsyncStorage.setItem(key, r.value); changed = true; }
      stamps[name] = { at: r.at, value: r.value };
    }
  }
  if (push.length) await addSettings(push);
  await AsyncStorage.setItem(STAMPS, JSON.stringify(stamps));
  return changed;
};
