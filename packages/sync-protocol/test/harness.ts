import { createHash } from 'node:crypto';
import { MemoryStore, type NoteState } from '@notespark/sync';
import { Client, type ClientOptions, FakeClock, Hub, Net, backoff } from '../src/index.ts';

export const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());

export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const T0 = '2026-01-01T00:00:00.000Z';
export const note = (title: string, content = `${title} body`, over: Partial<NoteState> = {}): NoteState => ({
  title, content, isMarkdown: true, isPinned: false, isArchived: false, deletedAt: null, createdAt: T0, updatedAt: T0, ...over,
});
export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export class Device {
  store: MemoryStore;
  client: Client | null = null;
  online = true;
  syncId?: string;
  states: string[] = [];
  world: World;
  constructor(world: World, clientId: number, syncId?: string) {
    this.world = world;
    this.store = new MemoryStore(clientId);
    this.syncId = syncId;
  }
  start(over: Partial<ClientOptions> = {}) {
    const w = this.world;
    this.client = new Client({
      store: this.store, clock: w.clock, rng: w.rng, hash: sha256, syncId: this.syncId,
      connect: () => {
        if (!this.online) return null;
        const [a, b] = w.net.pair();
        w.hub.accept(b);
        return a;
      },
      onState: s => this.states.push(s),
      ...over,
    });
    this.client.start();
  }
  restart(clientId: number) {
    this.syncId = this.client?.syncId ?? this.syncId;
    this.client?.stop();
    this.store = MemoryStore.restore(clientId, this.store.snapshot(), this.store.plain, this.store.plainBlobs);
    this.start();
  }
}

export class World {
  clock = new FakeClock();
  rng: () => number;
  net: Net;
  hubStore = new MemoryStore(1);
  hub: Hub;
  devices: Device[] = [];
  constructor(seed = 1) {
    this.rng = rng(seed);
    this.net = new Net(this.clock, this.rng);
    this.hub = new Hub(this.hubStore, this.clock, sha256);
  }
  device(syncId?: string) {
    const d = new Device(this, 100 + this.devices.length, syncId);
    this.devices.push(d);
    return d;
  }
  async run(ms: number) { await this.clock.advance(ms); }
}

export const backoffs = (rngSeed: number, n: number) => Array.from({ length: n }, (_, i) => backoff(i, rng(rngSeed + i)));
