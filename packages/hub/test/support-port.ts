import type { Port } from '../src/port.ts';

// Two connected ports; messages are cloned (like a real port) and arrive asynchronously. `cut` simulates a dead peer.
export const portPair = () => {
  let a: ((m: unknown) => void)[] = [], b: ((m: unknown) => void)[] = [];
  let cut = false;
  const mk = (mine: () => ((m: unknown) => void)[], theirs: () => ((m: unknown) => void)[]): Port => ({
    send: m => { if (cut) return; const c = structuredClone(m); queueMicrotask(() => { if (!cut) theirs().forEach(l => l(c)); }); },
    on: l => void mine().push(l),
  });
  return { a: mk(() => a, () => b), b: mk(() => b, () => a), cut: () => { cut = true; } };
};
