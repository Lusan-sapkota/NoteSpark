import type { Clock } from './clock.ts';

// A connection: whole messages in and out.
export interface Channel {
  send(data: Uint8Array): void;
  close(): void;
  onMessage: (data: Uint8Array) => void;
  onClose: () => void;
}

export interface Faults {
  drop: number;
  duplicate: number;
  delayMax: number; // ms, random per message, so some arrive out of order
  cut: number;
}
export const NO_FAULTS: Faults = { drop: 0, duplicate: 0, delayMax: 0, cut: 0 };

// Makes channel pairs; `faults` can change while it runs.
export class Net {
  faults: Faults = { ...NO_FAULTS };
  sent = 0;
  private clock: Clock;
  private rng: () => number;
  private latency: number;

  constructor(clock: Clock, rng: () => number, latency = 1) {
    this.clock = clock;
    this.rng = rng;
    this.latency = latency;
  }

  pair(): [Channel, Channel] {
    const ends: Channel[] = [0, 1].map(() => ({ send: () => {}, close: () => {}, onMessage: () => {}, onClose: () => {} }));
    let open = true;
    const shut = () => {
      if (!open) return;
      open = false;
      for (const e of ends) this.clock.after(this.latency, () => e.onClose());
    };
    ends.forEach((end, i) => {
      const peer = ends[1 - i];
      end.close = shut;
      end.send = data => {
        if (!open) return;
        this.sent++;
        const f = this.faults;
        if (this.rng() < f.cut) return shut();
        if (this.rng() < f.drop) return;
        const copies = this.rng() < f.duplicate ? 2 : 1;
        for (let c = 0; c < copies; c++)
          this.clock.after(this.latency + Math.floor(this.rng() * (f.delayMax + 1)), () => { if (open) peer.onMessage(data.slice()); });
      };
    });
    return [ends[0], ends[1]];
  }
}
