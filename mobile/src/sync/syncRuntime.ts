// What is running: at most one Client, for the profile that is open, while the app is in front and that profile's sync
// switch is on. Screens read the status and call `reconcileSync()` after anything that could change what should run.
// ponytail: one profile at a time, like the desktop (F45); other profiles sync while they are the open one.
import { AppState, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import { firefly, t } from '@notespark/core';
import type { Client, ClientState, LinkPlan, ProfileEntry } from '@notespark/sync-protocol';
import { linkedSyncId, unlinkSyncId } from '../storage/crdt';
import * as database from '../storage/database';
import { getActiveProfile } from '../storage/profiles';
import { storageStore } from '../storage/syncStore';
import { Notifications } from '../utils/notifications'; // null in Expo Go on Android: no background service there
import { deviceKey } from './deviceKey';
import { type HubRecord, getHubs, syncedProfiles } from './pairings';
import { createSyncClient } from './SyncManager';

export type SyncState = ClientState | 'unpaired';
export interface SyncStatus {
  state: SyncState;
  hub: HubRecord | null;
  profileId: string | null;
  lastSynced: number | null;
  problem: boolean;
  problemCode: number;
  closeCode: number;
  closeReason: string;
  lockedMatch: string | null;
  attempts: number;
}
export interface PendingLink { plan: LinkPlan; answer: (ok: boolean) => void }
export interface PendingPick { matches: ProfileEntry[]; name: string; answer: (syncId: string | null) => void }

let status: SyncStatus = {
  state: 'off', hub: null, profileId: null, lastSynced: null,
  problem: false, problemCode: 0, closeCode: 0, closeReason: '', lockedMatch: null, attempts: 0,
};
let client: Client | null = null;
let runningKey = '';
let token: Uint8Array | undefined; // from the scanned or pasted link; used by the first session only, never stored
let pendingLink: PendingLink | null = null;
let pendingPick: PendingPick | null = null;
const SERVICE_MS = 5 * 60 * 60 * 1000; // Android 15 limits a data sync service to about 6 hours a day; we stop first, and it starts again when the app is opened
let serviceOn = false;
const listeners = new Set<() => void>();
const events: string[] = []; // diagnostics: states and codes only, never note text or titles

const emit = () => listeners.forEach(l => l());
const set = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; emit(); };
const log = (e: string) => { events.push(`${new Date().toISOString()} ${e}`); if (events.length > 200) events.shift(); };

export const subscribeSync = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getSyncStatus = () => status;
export const getPendingLink = () => pendingLink;
export const getPendingPick = () => pendingPick;
export const clearLockedMatch = () => set({ lockedMatch: null });
export const syncDiagnostics = () => events.join('\n');
export const setPairingToken = (t: Uint8Array | undefined) => { token?.fill(0); token = t; };
export const syncNow = () => client?.nudge();
export const syncedProfileWarning = async (_profileId: string): Promise<string[] | null> => null;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Asked when the person turns sync on, never at start. Refused: sync still runs while the app is open.
export const askBackgroundPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !Notifications) return false;
  const have = await Notifications.getPermissionsAsync();
  return have.granted || (have.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
};

// The library keeps saying "running" after Android stops the service, so ask it every time instead of trusting our flag:
// a stale flag would either keep sync "on" with nothing holding the app awake, or refuse to start again after a kill.
const serviceRunning = () => Platform.OS === 'android' && !!Notifications && BackgroundService.isRunning();

const stopService = async () => {
  serviceOn = false;
  if (BackgroundService.isRunning()) await BackgroundService.stop().catch(() => {});
};

// The task only keeps the service alive; the client itself runs in the app's own JS. Only started while the app is in front (Android 12+).
const startService = async () => {
  if (Platform.OS !== 'android' || !Notifications) return;
  if (BackgroundService.isRunning()) { serviceOn = true; return; }
  serviceOn = false;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  try {
    await BackgroundService.start(async () => {
      const end = Date.now() + SERVICE_MS;
      while (BackgroundService.isRunning() && Date.now() < end) await sleep(30_000);
      log('service ended');
      await stopService();
      if (AppState.currentState !== 'active') stop(); // back to "sync while open"
    }, {
      taskName: 'notespark-sync', taskTitle: t('sync.title'), taskDesc: t('sync.serviceBody'),
      taskIcon: { name: 'notification_icon', type: 'drawable' }, color: firefly.light.primary, foregroundServiceType: ['dataSync'],
    });
    serviceOn = true;
    log('service started');
  } catch {
    serviceOn = false;
    log('service not started');
  }
};

const stop = () => {
  client?.stop();
  client = null;
  runningKey = '';
  if (pendingLink) { pendingLink.answer(false); pendingLink = null; }
  if (pendingPick) { pendingPick.answer(null); pendingPick = null; }
};

// The open profile forgets which profile it was linked to on the computer (deleted there, say) and links again as a new one.
export const relinkOpenProfile = async () => {
  stop();
  runningKey = '';
  await unlinkSyncId(database.db);
  await reconcileSync();
};

// Starts, keeps or stops the client to match: open profile, its sync switch, the paired computer, and the app being in front.
export const reconcileSync = async () => {
  const profileId = database.getOpenProfileId();
  const hubId = (await syncedProfiles())[profileId];
  const hub = hubId ? (await getHubs()).find(h => h.id === hubId) ?? null : null;
  const wanted = (AppState.currentState === 'active' || serviceOn) && !!hub;
  const key = `${profileId}:${hub?.id}:${token ? 'pair' : ''}`;
  if (!wanted) {
    stop();
    if (!hub) await stopService();
    return set({ state: hub ? 'off' : 'unpaired', hub, profileId, problem: false, problemCode: 0, closeCode: 0, closeReason: '' });
  }
  if (AppState.currentState === 'active') await startService();
  if (client && key === runningKey) return;
  stop();
  runningKey = key;
  const profile = await getActiveProfile();
  const linked = await linkedSyncId(database.db); // a profile that has linked before keeps its sync id
  const store = storageStore(database.db, profile.name, profileId);
  const c = createSyncClient({
    store, deviceKey: await deviceKey(), hub: hub!, deviceName: 'Phone', token,
    syncId: linked ?? undefined,
    link: !linked || token ? { syncId: '', name: profile.name } : undefined,
    relinkIfMissing: !!token,
    pickProfile: (matches, name) => new Promise<string | null>(resolve => {
      pendingPick = { matches, name, answer: picked => { pendingPick = null; emit(); resolve(picked); } };
      emit();
    }),
    onLockedMatch: name => { log('locked match: creating new profile'); set({ lockedMatch: name }); },
    confirmLink: plan => new Promise<boolean>(resolve => { pendingLink = { plan, answer: ok => { pendingLink = null; emit(); resolve(ok); } }; emit(); }),
    onClose: (code, reason) => { log(`close code=${code} reason=${reason}`); set({ closeCode: code, closeReason: reason, attempts: c.attempts }); },
    onProblem: p => { log(`problem code=${p.code}`); set({ problem: true, problemCode: p.code }); },
    onState: s => {
      log(`state ${s}`);
      if (s === 'live' && token) { setPairingToken(undefined); runningKey = `${profileId}:${hub?.id}:`; }
      set({
        state: s,
        attempts: c.attempts,
        problem: s === 'live' ? false : status.problem,
        problemCode: s === 'live' ? 0 : status.problemCode,
        closeCode: s === 'live' ? 0 : status.closeCode,
        closeReason: s === 'live' ? '' : status.closeReason,
        lastSynced: s === 'live' ? Date.now() : status.lastSynced,
      });
    },
  });
  client = c;
  set({ state: 'waiting', hub, profileId, problem: false, problemCode: 0, closeCode: 0, closeReason: '' });
  c.start();
};

// In the background the client keeps running only while the foreground service does; otherwise it stops and restarts when the app comes back.
AppState.addEventListener('change', state => {
  if (state === 'active') { void reconcileSync(); return; }
  if (!serviceRunning()) { serviceOn = false; stop(); }
});
// Android can take the service away (5-hour data sync limit, low memory, app swiped away): drop the client with it.
BackgroundService.on('expiration', () => { serviceOn = false; if (AppState.currentState !== 'active') stop(); });
