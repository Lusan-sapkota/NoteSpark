// One Client for one synced profile on this phone. The screens (and later the app lifecycle) start and stop it.
import './random';
import { sha256 } from '@noble/hashes/sha2.js';
import { Client, type ClientState, type Keypair, type LinkPlan, type Clock, realClock } from '@notespark/sync-protocol';
import type { SyncStore } from '@notespark/sync';
import { getRandomValues } from 'expo-crypto';
import { type HubRecord, hubKeyBytes } from './pairings';
import { type WSConstructor, rnConnector } from './rawSocket';

export interface ManagerOptions {
  store: SyncStore;
  deviceKey: Keypair;
  hub: HubRecord;
  deviceName: string;
  syncId?: string; // set once this profile has been linked
  link?: { syncId: string; name: string }; // first link; `syncId: ''` makes a new profile on the computer
  token?: Uint8Array; // pairing only: used until the first session is live, then dropped
  WebSocket?: WSConstructor; // tests pass `ws`
  clock?: Clock;
  confirmLink?: (plan: LinkPlan) => Promise<boolean>;
  onState?: (state: ClientState) => void;
  onProblem?: (problem: { code: number; doc: string }) => void;
}

const rng = () => getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

export const createSyncClient = (o: ManagerOptions): Client => {
  let token = o.token;
  const client: Client = new Client({
    store: o.store, clock: o.clock ?? realClock, rng, hash: data => sha256(data), syncId: o.syncId, link: o.link,
    connect: rnConnector({
      WebSocket: o.WebSocket ?? (globalThis.WebSocket as unknown as WSConstructor), deviceKey: o.deviceKey, hubKey: hubKeyBytes(o.hub), name: o.deviceName,
      addresses: o.hub.addresses.map(host => ({ host, port: o.hub.port })), token: () => token, clock: o.clock,
    }),
    confirmLink: o.confirmLink,
    onProblem: o.onProblem,
    onState: s => {
      if (s === 'live' && token) { token.fill(0); token = undefined; } // the token is for the first session only
      o.onState?.(s);
    },
  });
  return client;
};
