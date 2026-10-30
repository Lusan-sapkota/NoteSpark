// The computers this phone is paired with, and which profile syncs with which. Public data only: the hub's public key,
// its name and addresses. The device's private key is in deviceKey.ts and the one-time token is never stored.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type PairingLink, deviceId } from '@notespark/sync-protocol';

export interface HubRecord { id: string; name: string; hubKey: string; port: number; addresses: string[]; pairedAt: string }

const HUBS = 'syncHubs';
const PROFILES = 'syncProfiles'; // profile id -> hub id; present means the sync switch is on

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const hubKeyBytes = (h: HubRecord) => Uint8Array.from(h.hubKey.match(/../g) ?? [], x => parseInt(x, 16));
const read = async <T>(key: string, empty: T): Promise<T> => {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : empty; } catch { return empty; }
};

export const getHubs = () => read<HubRecord[]>(HUBS, []);

// Pairing again with a hub that has the same key replaces its record; the caller decides what to do about a different key.
export const saveHub = async (link: PairingLink, now = new Date()): Promise<HubRecord> => {
  const record: HubRecord = { id: deviceId(link.hubKey), name: link.name, hubKey: hex(link.hubKey), port: link.port, addresses: link.addresses, pairedAt: now.toISOString() };
  await AsyncStorage.setItem(HUBS, JSON.stringify([...(await getHubs()).filter(h => h.id !== record.id), record]));
  return record;
};

export const forgetHub = async (id: string) => {
  await AsyncStorage.setItem(HUBS, JSON.stringify((await getHubs()).filter(h => h.id !== id)));
  const profiles = await read<Record<string, string>>(PROFILES, {});
  for (const p of Object.keys(profiles)) if (profiles[p] === id) delete profiles[p];
  await AsyncStorage.setItem(PROFILES, JSON.stringify(profiles));
};

export const syncedProfiles = () => read<Record<string, string>>(PROFILES, {});
export const setProfileSync = async (profileId: string, hubId: string | null) => {
  const profiles = await syncedProfiles();
  if (hubId) profiles[profileId] = hubId; else delete profiles[profileId];
  await AsyncStorage.setItem(PROFILES, JSON.stringify(profiles));
};
