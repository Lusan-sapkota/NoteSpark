import type { SyncStore } from '@notespark/sync';
import type { Hash } from './adopt.ts';
import type { Channel } from './channel.ts';
import type { Clock } from './clock.ts';
import { type FanOut, Session, type SessionOptions } from './session.ts';

// The hub end: a session per device, and the fan-out (store first, then forward).
export class Hub implements FanOut {
  sessions = new Set<Session>(); // subscribed
  private open = new Set<Session>(); // every connection, subscribed or not
  private watching = new Map<string, () => void>();
  private store: SyncStore;
  private clock: Clock;
  private hash: Hash;

  constructor(store: SyncStore, clock: Clock, hash: Hash) {
    this.store = store;
    this.clock = clock;
    this.hash = hash;
  }

  accept(channel: Channel, extra: Partial<SessionOptions> = {}) {
    const session: Session = new Session({
      role: 'hub', store: this.store, channel, clock: this.clock, hash: this.hash, hub: this, ...extra,
      onClosed: (reason, code) => { this.open.delete(session); extra.onClosed?.(reason, code); },
    });
    this.open.add(session);
    return session;
  }

  async profileFor(syncId: string) {
    return (await this.store.profiles()).find(p => p.syncId === syncId) ?? null;
  }
  attach(session: Session) { this.sessions.add(session); }
  detach(session: Session) { this.sessions.delete(session); }

  // Changes made on the hub itself go to every device.
  watch(syncId: string) {
    if (this.watching.has(syncId)) return;
    this.watching.set(syncId, this.store.subscribe(syncId, (doc, bytes) => this.forward(syncId, doc, bytes, null)));
  }

  forward(syncId: string, doc: string, bytes: Uint8Array, from: Session | null) {
    for (const s of this.sessions) if (s !== from && s.syncId === syncId) s.push(doc, bytes);
  }

  stop() {
    for (const off of this.watching.values()) off();
    this.watching.clear();
    for (const s of [...this.open]) s.close('hub stopped');
  }
}
