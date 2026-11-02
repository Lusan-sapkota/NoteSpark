import type { SyncStore } from '@notespark/sync';
import type { Hash } from './adopt.ts';
import type { Channel } from './channel.ts';
import { type Clock, backoff } from './clock.ts';
import { type ProfileEntry, bytesToUuid } from './wire.ts';
import { type LinkPlan, Session, type SessionState, chooseProfileMatch } from './session.ts';

export type ClientState = 'off' | 'waiting' | 'connecting' | 'syncing' | 'live' | 'notLinked' | 'locked' | 'needsUpdate';

export interface ClientOptions {
  store: SyncStore;
  clock: Clock;
  rng: () => number;
  hash: Hash;
  connect: () => Channel | null; // null: no hub answers
  syncId?: string;
  link?: { syncId: string; name: string };
  chooseLink?: (profiles: ProfileEntry[]) => Promise<{ syncId: string; name: string } | null>;
  pickProfile?: (matches: ProfileEntry[], name: string) => Promise<string | null>;
  onLockedMatch?: (name: string) => void;
  relinkIfMissing?: boolean;
  confirmLink?: (plan: LinkPlan) => Promise<boolean>;
  onState?: (state: ClientState) => void;
  onClose?: (code: number, reason: string) => void;
  onProblem?: (problem: { code: number; doc: string }) => void;
}

// The device end: one session at a time, reconnecting with back-off.
export class Client {
  state: ClientState = 'off';
  syncId: string | undefined;
  closeCode = 0;
  closeReason = '';
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
    this.closeCode = 0;
    this.closeReason = '';
    this.set('off'); // first, so closing the session does not schedule a reconnect
    this.cancelRetry?.();
    this.session?.close('turned off');
    this.session = null;
  }
  // Try now instead of waiting.
  nudge() {
    if (this.state === 'waiting' || this.state === 'locked' || (this.state === 'notLinked' && this.closeReason === 'new profiles off')) {
      this.cancelRetry?.();
      this.attempt();
    }
  }

  private attempt() {
    const channel = this.o.connect();
    if (!channel) return this.retry();
    this.set('connecting');
    const canLink = !this.syncId || this.o.relinkIfMissing;
    this.session = new Session({
      role: 'client', store: this.o.store, channel, clock: this.o.clock, hash: this.o.hash,
      syncId: this.syncId,
      relinkIfMissing: this.o.relinkIfMissing,
      chooseLink: canLink && (this.o.chooseLink || this.o.link) ? profiles => this.resolveLink(profiles) : undefined,
      confirmLink: this.o.confirmLink,
      onProblem: this.o.onProblem,
      onState: (s: SessionState) => {
        if (s === 'syncing') { if (this.session?.syncId) this.syncId = this.session.syncId; this.set('syncing'); }
        if (s === 'live') {
          this.attempts = 0;
          this.closeCode = 0;
          this.closeReason = '';
          if (this.session?.syncId) this.syncId = this.session.syncId;
          this.o.relinkIfMissing = false;
          this.set('live');
        }
      },
      onClosed: (reason, code = 0) => {
        this.session = null;
        this.closeCode = code;
        this.closeReason = reason;
        this.o.onClose?.(code, reason);
        if (code === 403 || code === 409) return this.set(code === 403 ? 'notLinked' : 'needsUpdate');
        if (code === 423) { this.set('locked'); return this.retry(); }
        if (reason === 'link declined') return this.set('waiting');
        this.retry();
      },
    });
  }

  // A new profile's id is kept across attempts, so a lost answer does not make a second profile.
  private ensureNewId() {
    if (this.newId) return this.newId;
    const b = Array.from({ length: 16 }, () => Math.floor(this.o.rng() * 256));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    return (this.newId = bytesToUuid(Uint8Array.from(b)));
  }

  private async resolveLink(profiles: ProfileEntry[]): Promise<{ syncId: string; name: string } | null> {
    if (this.o.chooseLink) {
      const chosen = await this.o.chooseLink(profiles);
      if (!chosen) return null;
      return chosen.syncId ? chosen : { ...chosen, syncId: this.ensureNewId() };
    }
    const l = this.o.link;
    if (!l) return null;
    if (l.syncId) return l;
    const match = chooseProfileMatch(l.name, profiles);
    if (match.kind === 'join') return { syncId: match.profile.syncId, name: l.name };
    if (match.kind === 'ambiguous' && this.o.pickProfile) {
      const picked = await this.o.pickProfile(match.matches, l.name);
      if (picked === null) return null;
      return { syncId: picked || this.ensureNewId(), name: l.name };
    }
    if (match.kind === 'create' && match.lockedMatch) this.o.onLockedMatch?.(l.name);
    return { syncId: this.ensureNewId(), name: l.name };
  }

  private retry() {
    if (this.state === 'off') return;
    if (this.state !== 'locked') this.set('waiting');
    this.cancelRetry = this.o.clock.after(backoff(this.attempts, this.o.rng), () => this.attempt());
    this.attempts = Math.min(this.attempts + 1, 10);
  }
}
