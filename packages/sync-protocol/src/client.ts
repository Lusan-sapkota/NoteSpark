import type { SyncStore } from '@notespark/sync';
import type { Hash } from './adopt.ts';
import type { Channel } from './channel.ts';
import { type Clock, backoff } from './clock.ts';
import { bytesToUuid } from './wire.ts';
import { type LinkPlan, Session, type SessionState } from './session.ts';

export type ClientState = 'off' | 'waiting' | 'connecting' | 'syncing' | 'live' | 'notLinked' | 'locked' | 'needsUpdate';

export interface ClientOptions {
  store: SyncStore;
  clock: Clock;
  rng: () => number;
  hash: Hash;
  connect: () => Channel | null; // null: no hub answers
  syncId?: string;
  link?: { syncId: string; name: string };
  confirmLink?: (plan: LinkPlan) => Promise<boolean>;
  onState?: (state: ClientState) => void;
  onProblem?: (problem: { code: number; doc: string }) => void;
}

// The device end: one session at a time, reconnecting with back-off.
export class Client {
  state: ClientState = 'off';
  syncId: string | undefined;
  attempts = 0;
  session: Session | null = null;
  private o: ClientOptions;
  private cancelRetry: (() => void) | null = null;
  private newId: string | null = null;

  constructor(o: ClientOptions) {
    this.o = o;
    this.syncId = o.syncId;
  }

  private set(s: ClientState) {
    if (this.state === s) return;
    this.state = s;
    this.o.onState?.(s);
  }

  start() {
    if (this.state !== 'off') return;
    this.set('waiting');
    this.attempt();
  }
  stop() {
    this.set('off'); // first, so closing the session does not schedule a reconnect
    this.cancelRetry?.();
    this.session?.close('turned off');
    this.session = null;
  }
  // Try now instead of waiting.
  nudge() {
    if (this.state === 'waiting' || this.state === 'locked') { this.cancelRetry?.(); this.attempt(); }
  }

  private attempt() {
    const channel = this.o.connect();
    if (!channel) return this.retry();
    this.set('connecting');
    this.session = new Session({
      role: 'client', store: this.o.store, channel, clock: this.o.clock, hash: this.o.hash,
      syncId: this.syncId, link: this.syncId ? undefined : this.link(), confirmLink: this.o.confirmLink, onProblem: this.o.onProblem,
      onState: (s: SessionState) => {
        if (s === 'syncing') { this.syncId ||= this.session?.syncId; this.set('syncing'); }
        if (s === 'live') { this.attempts = 0; this.syncId ||= this.session?.syncId; this.set('live'); }
      },
      onClosed: (_reason, code) => {
        this.session = null;
        if (code === 403 || code === 409) return this.set(code === 403 ? 'notLinked' : 'needsUpdate');
        if (code === 423) { this.set('locked'); return this.retry(); }
        this.retry();
      },
    });
  }

  // A new profile's id is kept across attempts, so a lost answer does not make a second profile.
  private link() {
    const l = this.o.link;
    if (!l) return undefined;
    if (l.syncId) return l;
    const b = Array.from({ length: 16 }, () => Math.floor(this.o.rng() * 256));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    return { ...l, syncId: (this.newId ??= bytesToUuid(Uint8Array.from(b))) };
  }

  private retry() {
    if (this.state === 'off') return;
    if (this.state !== 'locked') this.set('waiting');
    this.cancelRetry = this.o.clock.after(backoff(this.attempts, this.o.rng), () => this.attempt());
    this.attempts = Math.min(this.attempts + 1, 10);
  }
}
