// What is running: at most one Client, for the profile that is open, while the app is in front and that profile's sync
// switch is on. Screens read the status and call `reconcileSync()` after anything that could change what should run.
// ponytail: one profile at a time, like the desktop (F45); other profiles sync while they are the open one.
import { AppState, Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import { firefly, t } from '@notespark/core';
import type { Client, ClientState, LinkPlan } from '@notespark/sync-protocol';
import { linkedSyncId } from '../storage/crdt';
import * as database from '../storage/database';
import { getActiveProfile } from '../storage/profiles';
import { storageStore } from '../storage/syncStore';
import { Notifications } from '../utils/notifications'; // null in Expo Go on Android: no background service there
import { deviceKey } from './deviceKey';
import { type HubRecord, getHubs, syncedProfiles } from './pairings';
import { createSyncClient } from './SyncManager';

export type SyncState = ClientState | 'unpaired';
export interface SyncStatus { state: SyncState; hub: HubRecord | null; profileId: string | null; lastSynced: number | null; problem: boolean; attempts: number }
export interface PendingLink { plan: LinkPlan; answer: (ok: boolean) => void }

let status: SyncStatus = { state: 'off', hub: null, profileId: null, lastSynced: null, problem: false, attempts: 0 };
let client: Client | null = null;
let runningKey = '';
let token: Uint8Array | undefined; // from the scanned or pasted link; used by the first session only, never stored
let pendingLink: PendingLink | null = null;
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
export const syncDiagnostics = () => events.join('\n');
export const setPairingToken = (t: Uint8Array | undefined) => { token?.fill(0); token = t; };
export const syncNow = () => client?.nudge();

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Asked when the person turns sync on, never at start. Refused: sync still runs while the app is open.
export const askBackgroundPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !Notifications) return false;
  const have = await Notifications.getPermissionsAsync();
  return have.granted || (have.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
};

const stopService = async () => {
  serviceOn = false;
  if (BackgroundService.isRunning()) await BackgroundService.stop().catch(() => {});
};

// The task only keeps the service alive; the client itself runs in the app's own JS. Only started while the app is in front (Android 12+).
const startService = async () => {
  if (Platform.OS !== 'android' || !Notifications || serviceOn || BackgroundService.isRunning()) return;
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
    log('service not started');
  }
};

const stop = () => {
  client?.stop();
  client = null;
  runningKey = '';
  if (pendingLink) { pendingLink.answer(false); pendingLink = null; }
};

// Starts, keeps or stops the client to match: open profile, its sync switch, the paired computer, and the app being in front.
export const reconcileSync = async () => {
  const profileId = database.getOpenProfileId();
  const hubId = (await syncedProfiles())[profileId];
  const hub = hubId ? (await getHubs()).find(h => h.id === hubId) ?? null : null;
  const wanted = (AppState.currentState === 'active' || serviceOn) && !!hub;
  const key = `${profileId}:${hub?.id}`;
  if (!wanted) {
    stop();
    if (!hub) await stopService();
    return set({ state: hub ? 'off' : 'unpaired', hub, profileId, problem: false });
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
    syncId: linked ?? undefined, link: linked ? undefined : { syncId: '', name: profile.name }, // ponytail: a new profile on the computer; joining an existing one comes with the profile picker
    confirmLink: plan => new Promise<boolean>(resolve => { pendingLink = { plan, answer: ok => { pendingLink = null; emit(); resolve(ok); } }; emit(); }),
    onProblem: p => { log(`problem code=${p.code}`); set({ problem: true }); },
    onState: s => {
      log(`state ${s}`);
      if (s === 'live' && token) setPairingToken(undefined);
      set({ state: s, attempts: c.attempts, problem: s === 'live' ? false : status.problem, lastSynced: s === 'live' ? Date.now() : status.lastSynced });
    },
  });
  client = c;
  set({ state: 'waiting', hub, profileId, problem: false });
  c.start();
};

// In the background the client keeps running only while the foreground service does; otherwise it stops and restarts when the app comes back.
AppState.addEventListener('change', state => { if (state === 'active') void reconcileSync(); else if (!serviceOn) stop(); });
