// The main-process side of the hub process: spawns it (through the supervisor), serves it the real store, sends control
// calls, and kills it when it stops answering pings. Electron-free: the desktop passes a `spawn` over `utilityProcess`.
import type { SyncStore } from '@notespark/sync';
import type { Clock } from '@notespark/sync-protocol';
import type { Port } from './port.ts';
import { serveStore } from './storeRpc.ts';
import { type Child, Supervisor, type SupervisorState } from './supervisor.ts';
import type { WorkerConfig } from './worker.ts';

export interface Spawned extends Child { port: Port }

export interface ControllerOptions {
  spawn: () => Spawned;
  store: SyncStore;
  clock: Clock;
  config: () => Promise<WorkerConfig> | WorkerConfig;
  onStatus?: (s: ControllerStatus) => void;
  onEvent?: (ev: any) => void;
  pingMs?: number;
  deadMs?: number;
  callTimeoutMs?: number;
  minMs?: number; // restart back-off, for tests
  maxMs?: number;
}
export interface ControllerStatus { state: 'stopped' | 'starting' | 'running' | 'restarting' | 'problem'; message?: string; port?: number; hosts?: string[] }

export class HubController {
  status: ControllerStatus = { state: 'stopped' };
  private o: ControllerOptions;
  private sup: Supervisor;
  private live: { port: Port; pending: Map<number, { resolve(v: any): void; reject(e: Error): void; stop(): void }>; dispose(): void } | null = null;
  private counter = 0;

  constructor(o: ControllerOptions) {
    this.o = o;
    this.sup = new Supervisor({
      clock: o.clock, minMs: o.minMs, maxMs: o.maxMs,
      spawn: () => this.launch(),
      onState: s => { if (s === 'restarting') this.set({ state: 'restarting', message: 'Sync stopped, restarting' }); },
    });
  }
  private set(s: ControllerStatus) { this.status = s; this.o.onStatus?.(s); }

  start() {
    this.set({ state: 'starting' });
    this.sup.start();
  }
  stop() {
    this.sup.stop();
    this.set({ state: 'stopped' });
  }
  get restarts() { return this.sup.restarts; }

  private launch(): Child {
    const child = this.o.spawn();
    const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void; stop(): void }>();
    const dropStore = serveStore(child.port, this.o.store);
    let lastPong = this.o.clock.now();
    let alive = true;
    const live = { port: child.port, pending, dispose: () => { alive = false; dropStore(); for (const p of pending.values()) { p.stop(); p.reject(new Error('Sync stopped, restarting')); } pending.clear(); } };
    this.live = live;
    child.port.on(raw => {
      const m = raw as any;
      if (!m || typeof m !== 'object') return;
      if (m.k === 'c:pong') lastPong = this.o.clock.now();
      else if (m.k === 'c:ev') this.o.onEvent?.(m.ev);
      else if (m.k === 'c:ret') {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        p.stop();
        if (m.ok) p.resolve(m.value); else p.reject(Object.assign(new Error(m.message), { code: m.code }));
      }
    });
    // Watchdog: a process that is alive but silent is killed, and the supervisor starts a new one.
    const watch = () => {
      if (!alive) return;
      child.port.send({ k: 'c:ping' });
      this.o.clock.after(this.o.pingMs ?? 5000, () => {
        if (!alive) return;
        if (this.o.clock.now() - lastPong > (this.o.deadMs ?? 15_000)) return child.kill();
        watch();
      });
    };
    watch();
    child.onExit(() => { if (this.live === live) this.live = null; live.dispose(); });
    // Every new process is told its configuration; a device list that cannot be trusted ends the restarts.
    void (async () => {
      try {
        const info = await this.callOn(live, 'start', await this.o.config());
        if (alive) this.set({ state: 'running', port: info.port, hosts: info.hosts });
      } catch (e: any) {
        if (!alive) return;
        if (e?.code === 'DEVICE_LIST') { this.sup.stop(); this.set({ state: 'problem', message: e.message }); }
        else if (e?.code === 'BAD_KEY') { this.sup.stop(); this.set({ state: 'problem', message: 'The sync key is damaged.' }); }
        else child.kill();
      }
    })();
    return child;
  }

  private callOn(live: NonNullable<HubController['live']>, op: string, args?: unknown) {
    return new Promise<any>((resolve, reject) => {
      const id = ++this.counter;
      const stop = this.o.clock.after(this.o.callTimeoutMs ?? 30_000, () => { live.pending.delete(id); reject(new Error(`${op} timed out`)); });
      live.pending.set(id, { resolve, reject, stop });
      live.port.send({ k: 'c:call', id, op, args });
    });
  }
  call(op: string, args?: unknown) {
    if (!this.live) return Promise.reject(Object.assign(new Error('Sync is not running'), { code: 'NOT_RUNNING' }));
    return this.callOn(this.live, op, args);
  }
}
