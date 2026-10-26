// Injected time, so tests run in virtual time.
export interface Clock {
  now(): number;
  after(ms: number, fn: () => void): () => void
}

export const realClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export class FakeClock implements Clock {
  time = 0;
  private timers: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  now() { return this.time; }
  after(ms: number, fn: () => void) {
    const t = { at: this.time + Math.max(0, ms), seq: this.seq++, fn };
    this.timers.push(t);
    return () => { this.timers = this.timers.filter(x => x !== t); };
  }
  // Runs due timers in order, letting pending promises finish between them.
  async advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      await settle();
      const next = this.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.timers = this.timers.filter(t => t !== next);
      this.time = Math.max(this.time, next.at);
      next.fn();
    }
    this.time = end;
    await settle();
  }
  pending() { return this.timers.length; }
}

export const settle = () => new Promise<void>(resolve => setImmediate(resolve));

// 1 s doubling to 60 s, plus or minus 20 %.
export const backoff = (attempt: number, rng: () => number) => Math.min(60_000, 1000 * 2 ** attempt) * (0.8 + 0.4 * rng());
