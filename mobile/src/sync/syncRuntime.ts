// What is running: at most one Client, for the profile that is open, while the app is in front and that profile's sync
// switch is on. Screens read the status and call `reconcileSync()` after anything that could change what should run.
// ponytail: one profile at a time, like the desktop (F45); other profiles sync while they are the open one.
import { AppState } from 'react-native';
import type { Client, ClientState, LinkPlan } from '@notespark/sync-protocol';
import { linkedSyncId } from '../storage/crdt';
import * as database from '../storage/database';
import { getActiveProfile } from '../storage/profiles';
import { storageStore } from '../storage/syncStore';
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
  const wanted = AppState.currentState === 'active' && !!hub;
  const key = `${profileId}:${hub?.id}`;
  if (!wanted) {
    stop();
    return set({ state: hub ? 'off' : 'unpaired', hub, profileId, problem: false });
  }
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

// Foreground only for now: stop when the app goes to the background, start when it comes back (the foreground service replaces this).
AppState.addEventListener('change', state => { if (state === 'active') void reconcileSync(); else stop(); });
