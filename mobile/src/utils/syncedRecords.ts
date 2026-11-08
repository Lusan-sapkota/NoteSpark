import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SettingEntry } from '@notespark/sync';
import { addSettings, getSettingsData } from '../storage/notes';
import { getActiveProfile, renameProfile } from '../storage/profiles';

// What else follows a synced profile, as small records in its catalog (same store as the synced settings):
// Tidy up hides (a hide is never undone, so the devices' hides are simply added together), the profile's name (newest wins)
// and the import and export history (added together; clearing it on one device clears it on all, for entries up to then).
const HIDDEN = (id: string) => `tidyHidden:${id}`;
const NAME_STAMP = (id: string) => `syncedNameStamp:${id}`;
const HISTORY = 'notesHistory';
const PAIR = /^[0-9a-f-]{36}-[0-9a-f-]{36}$/;
const HISTORY_KEPT = 20;

const read = async <T>(key: string, fallback: T): Promise<T> => {
  try { return JSON.parse((await AsyncStorage.getItem(key)) ?? 'null') ?? fallback; } catch { return fallback; }
};
const eventName = (e: { date: string }) => `import:${e.date.replace(/[^A-Za-z0-9]/g, '-')}`;

// Clearing the history writes a marker, so the other devices drop what was there.
export const markHistoryCleared = (): Promise<void> => addSettings([{ name: 'importCleared', value: String(Date.now()), at: Date.now() }]).catch(() => {});

export const syncRecords = async (): Promise<void> => {
  const { synced, settings } = await getSettingsData();
  if (!synced) return;
  const remote = new Map(settings.map(s => [s.name, s]));
  const profile = await getActiveProfile();
  const push: SettingEntry[] = [];
  const at = Date.now();

  // Tidy up hides
  const hidden = await read<string[]>(HIDDEN(profile.id), []);
  const merged = new Set(hidden);
  for (const key of hidden) if (PAIR.test(key) && !remote.has(`hide:${key}`)) push.push({ name: `hide:${key}`, value: '1', at });
  for (const name of remote.keys()) if (name.startsWith('hide:') && PAIR.test(name.slice(5))) merged.add(name.slice(5));
  if (merged.size !== hidden.length) await AsyncStorage.setItem(HIDDEN(profile.id), JSON.stringify([...merged]));

  // The profile's name
  const stamp = await read<{ at: number; value: string } | null>(NAME_STAMP(profile.id), null);
  const nameRecord = remote.get('profileName');
  if (stamp ? profile.name !== stamp.value : !nameRecord) {
    push.push({ name: 'profileName', value: profile.name.slice(0, 100), at });
    await AsyncStorage.setItem(NAME_STAMP(profile.id), JSON.stringify({ at, value: profile.name }));
  } else if (nameRecord && nameRecord.at > (stamp?.at ?? -1)) {
    if (nameRecord.value && nameRecord.value !== profile.name) await renameProfile(profile.id, nameRecord.value);
    await AsyncStorage.setItem(NAME_STAMP(profile.id), JSON.stringify({ at: nameRecord.at, value: nameRecord.value }));
  }

  // Import and export history
  const cleared = Number(remote.get('importCleared')?.value ?? 0) || 0;
  const local = (await read<{ date: string }[]>(HISTORY, [])).filter(e => e && typeof e.date === 'string');
  const byName = new Map<string, any>();
  for (const e of local) if (Date.parse(e.date) > cleared) byName.set(eventName(e), e);
  for (const [name, r] of remote) {
    if (!name.startsWith('import:')) continue;
    try { const e = JSON.parse(r.value); if (e && typeof e.date === 'string' && Date.parse(e.date) > cleared) byName.set(name, e); } catch { /* skip */ }
  }
  for (const [name, e] of byName) if (!remote.has(name) && JSON.stringify(e).length <= 300) push.push({ name, value: JSON.stringify(e), at });
  const all = [...byName.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, HISTORY_KEPT);
  if (JSON.stringify(all) !== JSON.stringify(local)) await AsyncStorage.setItem(HISTORY, JSON.stringify(all));

  if (push.length) await addSettings(push);
};
