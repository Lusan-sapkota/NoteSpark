// Keeps a helper process alive: restart with back-off (1 s doubling to 60 s, reset after a stable minute), and a status
// the window can show. The process itself is injected, so the loop runs in tests with a fake clock.
import type { Clock } from '@notespark/sync-protocol';

export interface Child {
  kill(): void;
  onExit(cb: () => void): void;
}
export type SupervisorState = 'stopped' | 'running' | 'restarting';

export interface SupervisorOptions {
  spawn: () => Child;
  clock: Clock;
  onState?: (state: SupervisorState) => void;
  minMs?: number;
  maxMs?: number;
  stableMs?: number;
}

export class Supervisor {
  state: SupervisorState = 'stopped';
  restarts = 0;
  private child: Child | null = null;
  private delay: number;
  private startedAt = 0;
  private cancel: (() => void) | null = null;
  private o: SupervisorOptions;
  constructor(o: SupervisorOptions) { this.o = o; this.delay = o.minMs ?? 1000; }

  private set(s: SupervisorState) { if (this.state !== s) { this.state = s; this.o.onState?.(s); } }

  start() {
    if (this.state !== 'stopped') return;
    this.launch();
  }
  stop() {
    this.cancel?.();
    this.cancel = null;
    const c = this.child;
    this.child = null;
    this.set('stopped');
    c?.kill();
  }
  // A process that is alive but not answering (the caller's ping failed): kill it, the exit handler restarts it.
  kick() { this.child?.kill(); }

  private launch() {
    this.startedAt = this.o.clock.now();
    let child: Child;
    try { child = this.o.spawn(); } catch { this.set('restarting'); return this.schedule(); }
    this.child = child;
    this.set('running');
    child.onExit(() => {
      if (this.child !== child) return; // stopped on purpose, or an older process
      this.child = null;
      this.set('restarting');
      this.restarts++;
      if (this.o.clock.now() - this.startedAt >= (this.o.stableMs ?? 60_000)) this.delay = this.o.minMs ?? 1000;
      this.schedule();
    });
  }
  private schedule() {
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, this.o.maxMs ?? 60_000);
    this.cancel = this.o.clock.after(wait, () => { this.cancel = null; if (this.state === 'restarting') this.launch(); });
  }
}
