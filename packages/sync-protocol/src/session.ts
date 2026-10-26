import type { SyncStore } from '@notespark/sync';
import { type Hash, fingerprints, planAdoption } from './adopt.ts';
import type { Channel } from './channel.ts';
import type { Clock } from './clock.ts';
import { CHUNK, type Frame, type LinkEntry, MAX_DOCS_IN_FLIGHT, MAX_DOC_BYTES, MAX_LINK_ENTRIES, type PairEntry, ProtocolError, Reassembler, T, chunkUpdate, decodeFrame, encodeFrame } from './wire.ts';

export const PING_EVERY = 15_000;
export const DEAD_AFTER = 45_000;
export const RECONCILE_EVERY = 30_000;
export const PULL_TIMEOUT = 20_000;
export const PHASE_TIMEOUT = 30_000;
export const CONFIRM_TIMEOUT = 10 * 60_000

export type SessionState = 'start' | 'linking' | 'syncing' | 'live' | 'closed';

export interface LinkPlan {
  syncId: string;
  hubNotes: number;
  pairs: PairEntry[];
}

export interface FanOut {
  forward(syncId: string, doc: string, bytes: Uint8Array, from: Session | null): void;
  watch(syncId: string): void;
  profileFor(syncId: string): Promise<{ locked: boolean } | null>;
  attach(session: Session): void;
  detach(session: Session): void;
}

export interface SessionOptions {
  role: 'client' | 'hub';
  store: SyncStore;
  channel: Channel;
  clock: Clock;
  hash: Hash;
  // client: the linked profile, or how to link one and whether to accept the plan
  syncId?: string;
  link?: { syncId: string; name: string };
  confirmLink?: (plan: LinkPlan) => Promise<boolean>;
  hub?: FanOut;
  onState?: (state: SessionState) => void;
  onClosed?: (reason: string, code?: number) => void;
  // A document this side will not send (413).
  onProblem?: (problem: { code: number; doc: string }) => void;
}

// One connection, either end: pull what is lacking, say READY, then push changes. Inputs run in order; every wait times out.
export class Session {
  state: SessionState = 'start';
  syncId = '';
  closeReason = '';
  closeCode = 0;
  private o: SessionOptions;
  private chain: Promise<void> = Promise.resolve();
  private assembler = new Reassembler();
  private nextId = 1;
  private lastRecv: number;
  private lastSend: number;
  private cancels: (() => void)[] = [];
  private unsubscribe: (() => void) | null = null;
  private exchanging = false;
  private firstExchange = true;
  private pending: string[] = [];
  private inflight = new Set<string>();
  private readySent = false;
  private peerReady = false;
  private pullTimer: (() => void) | null = null;
  private phaseTimer: (() => void) | null = null;
  private answering = new Set<string>();
  private linkEntries: LinkEntry[] = [];
  private planPairs: PairEntry[] = [];
  private linkSyncId = '';
  private planned: LinkPlan | null = null;

  constructor(o: SessionOptions) {
    this.o = o;
    this.lastRecv = this.lastSend = o.clock.now();
    o.channel.onMessage = data => this.receive(data);
    o.channel.onClose = () => this.close('closed');
    this.cancels.push(o.clock.after(PING_EVERY, () => this.heartbeat()));
    this.phase(PHASE_TIMEOUT);
    if (o.role === 'hub') this.queue(async () => this.send({ type: T.PROFILES, profiles: (await o.store.profiles()).map(p => ({ ...p })) }));
  }

  private send(f: Frame) {
    if (this.state === 'closed') return;
    this.lastSend = this.o.clock.now();
    this.o.channel.send(encodeFrame(f));
  }
  private queue(work: () => Promise<void>) {
    this.chain = this.chain.then(async () => {
      if (this.state === 'closed') return;
      try { await work(); } catch (e) { this.fail(e); }
    });
  }
  private fail(e: unknown) {
    const code = e instanceof ProtocolError ? e.code : 500;
    this.send({ type: T.ERROR, code, message: code === 500 ? 'internal error' : (e as Error).message });
    this.close(`failed ${code}`, code);
  }
  close(reason: string, code = 0) {
    if (this.state === 'closed') return;
    this.setState('closed');
    this.closeReason = reason;
    this.closeCode = code;
    this.cancels.forEach(c => c());
    this.pullTimer?.();
    this.phaseTimer?.();
    this.unsubscribe?.();
    this.o.hub?.detach(this);
    this.o.channel.close();
    this.o.onClosed?.(reason, code);
  }
  private setState(s: SessionState) {
    if (this.state === s) return;
    this.state = s;
    this.o.onState?.(s);
  }
  private heartbeat() {
    if (this.state === 'closed') return;
    const now = this.o.clock.now();
    if (now - this.lastRecv >= DEAD_AFTER) return this.close('timeout');
    if (now - this.lastSend >= PING_EVERY) this.send({ type: T.PING, nonce: now });
    this.cancels.push(this.o.clock.after(PING_EVERY, () => this.heartbeat()));
    if (this.state === 'live' && now - this.lastReconcile >= RECONCILE_EVERY && !this.exchanging) this.reconcile();
  }
  private lastReconcile = 0;

  private receive(data: Uint8Array) {
    if (this.state === 'closed') return;
    this.lastRecv = this.o.clock.now();
    let f: Frame;
    try { f = decodeFrame(data); } catch (e) { return this.fail(e); }
    // Counted before the queue, so a flood is refused.
    if (f.type === T.SV && f.doc !== 'catalog' && !this.answering.has(f.doc)) {
      if (this.answering.size >= MAX_DOCS_IN_FLIGHT) return this.fail(new ProtocolError(400, 'too many documents in flight'));
      this.answering.add(f.doc);
    }
    this.queue(() => this.handle(f));
  }

  // Gives up waiting for the other end after `ms`.
  private phase(ms: number | null) {
    this.phaseTimer?.();
    this.phaseTimer = ms === null ? null : this.o.clock.after(ms, () => this.close('timeout'));
  }

  private subscribed() { return this.state === 'syncing' || this.state === 'live'; }

  private async handle(f: Frame) {
    switch (f.type) {
      case T.PING: return this.send({ type: T.PONG, nonce: f.nonce });
      case T.PONG: return;
      case T.ERROR: return this.close(`peer error ${f.code}`, f.code);
      case T.BYE: return this.close(`peer closed: ${f.reason}`);
    }
    if (this.o.role === 'hub') return this.handleAsHub(f);
    return this.handleAsClient(f);
  }

  private async handleAsHub(f: Frame) {
    switch (f.type) {
      case T.LINK: return this.hubLink(f);
      case T.LINK_CONFIRM:
        if (!this.planned || f.syncId !== this.planned.syncId) throw new ProtocolError(400, 'unexpected confirm');
        if (!f.accept) return this.close('link declined');
        return;
      case T.SUBSCRIBE: {
        if (this.subscribed()) return;
        this.phase(null);
        const profile = await this.o.hub!.profileFor(f.syncId);
        if (!profile) throw new ProtocolError(403, 'profile not linked');
        if (profile.locked) throw new ProtocolError(423, 'profile is locked');
        this.syncId = f.syncId;
        this.o.hub!.attach(this);
        this.o.hub!.watch(f.syncId);
        this.setState('syncing');
        return this.startExchange();
      }
      default: return this.handleSynced(f);
    }
  }

  private async hubLink(f: Extract<Frame, { type: 0x04 }>) {
    if (this.subscribed()) throw new ProtocolError(400, 'already subscribed');
    this.state === 'start' && this.setState('linking');
    if (this.linkEntries.length + f.entries.length > 1_000_000) throw new ProtocolError(413, 'too many notes to link');
    this.linkEntries.push(...f.entries);
    this.linkSyncId = f.syncId;
    if (f.more) return;
    const syncId = f.syncId;
    const store = this.o.store;
    let profile = await this.o.hub!.profileFor(syncId);
    if (!profile && f.name === '') throw new ProtocolError(403, 'profile not found');
    if (!profile) await store.createProfile(syncId, f.name);
    else if (profile.locked) throw new ProtocolError(423, 'profile is locked');
    const hubEntries = fingerprints(await store.plainNotes(syncId), this.o.hash);
    const pairs = planAdoption(this.linkEntries, hubEntries);
    const hubNotes = (await store.plainNotes(syncId)).length;
    this.planned = { syncId, hubNotes, pairs };
    this.phase(CONFIRM_TIMEOUT);
    this.linkEntries = [];
    for (let i = 0; i === 0 || i < pairs.length; i += MAX_LINK_ENTRIES)
      this.send({ type: T.LINK_PLAN, syncId, hubNotes, clientNotes: 0, more: i + MAX_LINK_ENTRIES < pairs.length, pairs: pairs.slice(i, i + MAX_LINK_ENTRIES) });
  }

  private async handleAsClient(f: Frame) {
    switch (f.type) {
      case T.PROFILES: {
        if (this.state !== 'start') return;
        if (this.o.syncId) {
          const mine = f.profiles.find(p => p.syncId === this.o.syncId);
          if (!mine) throw new ProtocolError(403, 'profile not linked');
          if (mine.locked) throw new ProtocolError(423, 'profile is locked');
          return this.subscribe(this.o.syncId);
        }
        if (!this.o.link) throw new ProtocolError(403, 'no profile to sync');
        this.setState('linking');
        const entries = fingerprints(await this.o.store.plainNotes(''), this.o.hash);
        for (let i = 0; i === 0 || i < entries.length; i += MAX_LINK_ENTRIES)
          this.send({ type: T.LINK, syncId: this.o.link.syncId, name: this.o.link.name, more: i + MAX_LINK_ENTRIES < entries.length, entries: entries.slice(i, i + MAX_LINK_ENTRIES) });
        this.phase(PHASE_TIMEOUT);
        return;
      }
      case T.LINK_PLAN: {
        if (this.state !== 'linking') throw new ProtocolError(400, 'unexpected plan');
        this.planPairs.push(...f.pairs);
        this.linkSyncId = f.syncId;
        if (f.more) return;
        this.phase(null);
        const plan: LinkPlan = { syncId: f.syncId, hubNotes: f.hubNotes, pairs: this.planPairs };
        const accept = (await this.o.confirmLink?.(plan)) ?? true;
        this.send({ type: T.LINK_CONFIRM, syncId: plan.syncId, accept });
        if (!accept) return this.close('link declined');
        await this.o.store.link(plan.syncId, new Map(plan.pairs.map(p => [p.clientUuid, p.hubUuid])));
        return this.subscribe(plan.syncId);
      }
      default: return this.handleSynced(f);
    }
  }

  private subscribe(syncId: string) {
    this.syncId = syncId;
    this.phase(null);
    this.send({ type: T.SUBSCRIBE, syncId });
    this.unsubscribe = this.o.store.subscribe(syncId, (doc, bytes) => this.push(doc, bytes));
    this.setState('syncing');
    return this.startExchange();
  }

  private async handleSynced(f: Frame) {
    if (!this.subscribed()) throw new ProtocolError(400, 'not subscribed');
    switch (f.type) {
      case T.SV: {
        const update = await this.o.store.diff(this.syncId, f.doc, f.stateVector);
        if (update.length > MAX_DOC_BYTES) this.o.onProblem?.({ code: 413, doc: f.doc });
        else if (update.length > 2) for (const c of chunkUpdate(f.doc, this.nextId++, update)) this.send(c);
        this.send({ type: T.DOC_DONE, doc: f.doc });
        this.answering.delete(f.doc);
        return;
      }
      case T.UPDATE: {
        const bytes = this.assembler.add(f);
        if (!bytes) return;
        try { await this.o.store.apply(this.syncId, f.doc, [bytes]); } catch (e) { throw new ProtocolError(400, 'bad update'); }
        this.o.hub?.forward(this.syncId, f.doc, bytes, this);
        return;
      }
      case T.DOC_DONE: return this.pulled(f.doc);
      case T.READY: this.peerReady = true; return this.maybeLive();
      default: throw new ProtocolError(400, 'unexpected frame');
    }
  }

  private async startExchange() {
    if (this.exchanging) return;
    this.exchanging = true;
    this.lastReconcile = this.o.clock.now();
    this.pending = [];
    this.inflight = new Set(['catalog']);
    this.armPullTimer();
    this.send({ type: T.SV, doc: 'catalog', stateVector: await this.o.store.stateVector(this.syncId, 'catalog') });
  }
  private reconcile() { this.queue(() => this.startExchange()); }

  private armPullTimer() {
    this.pullTimer?.();
    this.pullTimer = this.o.clock.after(PULL_TIMEOUT, () => this.close('timeout'));
  }

  private async pulled(doc: string) {
    if (!this.inflight.delete(doc)) return
    this.armPullTimer();
    if (doc === 'catalog') this.pending = await this.o.store.docs(this.syncId);
    while (this.inflight.size < MAX_DOCS_IN_FLIGHT && this.pending.length) {
      const next = this.pending.shift()!;
      this.inflight.add(next);
      this.send({ type: T.SV, doc: next, stateVector: await this.o.store.stateVector(this.syncId, next) });
    }
    if (this.inflight.size === 0 && this.pending.length === 0) {
      this.pullTimer?.();
      this.pullTimer = null;
      this.exchanging = false;
      if (this.firstExchange && !this.readySent) { this.readySent = true; this.send({ type: T.READY }); if (!this.peerReady) this.phase(PHASE_TIMEOUT * 2); }
      this.maybeLive();
    }
  }

  private maybeLive() {
    if (this.readySent && this.peerReady && this.state === 'syncing') { this.firstExchange = false; this.phase(null); this.setState('live'); }
  }

  // Never the only copy: the next exchange sends it again.
  push(doc: string, bytes: Uint8Array) {
    if (!this.subscribed() || bytes.length <= 2) return;
    if (bytes.length > MAX_DOC_BYTES) return this.o.onProblem?.({ code: 413, doc });
    for (const c of chunkUpdate(doc, this.nextId++, bytes)) this.send(c);
  }
}

export { CHUNK };
