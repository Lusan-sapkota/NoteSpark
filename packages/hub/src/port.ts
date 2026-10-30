// A message channel between two processes. Messages are structured-cloneable (Uint8Array survives), so a
// `utilityProcess` parent port and a `child_process` fork with `serialization: 'advanced'` both fit.
export interface Port {
  send(message: unknown): void;
  on(listener: (message: unknown) => void): void;
}

// Electron: `process.parentPort` in the utility process, the `UtilityProcess` object in main (its events carry `data`).
export const fromMessagePort = (p: { postMessage(m: unknown): void; on(event: 'message', cb: (e: { data: unknown }) => void): unknown }): Port => ({
  send: m => p.postMessage(m),
  on: cb => void p.on('message', e => cb(e.data)),
});

// Node: a forked child (in the parent) or `process` (in the child).
export const fromProcess = (p: { send?(m: unknown): unknown; on(event: 'message', cb: (m: unknown) => void): unknown }): Port => ({
  send: m => { try { p.send?.(m); } catch { /* the other end is gone */ } },
  on: cb => void p.on('message', cb),
});
