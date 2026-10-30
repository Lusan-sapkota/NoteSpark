// The SyncStore across a Port: the hub process holds `remoteStore`, the main process (the only owner of the databases)
// runs `serveStore`. Everything the worker sends is checked here, because the worker is the part that parses network input.
import type { FileEdit, ProfileInfo, SyncStore } from '@notespark/sync';
import type { Port } from './port.ts';

export const MAX_IN_FLIGHT = 64;
const MAX_STRING = 4096;

type Msg =
  | { k: 's:call'; id: number; op: string; args: unknown[] }
  | { k: 's:ret'; id: number; ok: true; value: unknown }
  | { k: 's:ret'; id: number; ok: false; message: string; code?: string }
  | { k: 's:sub'; sub: number; op: 'subscribe' | 'onNoteChange'; syncId: string }
  | { k: 's:unsub'; sub: number }
  | { k: 's:ev'; sub: number; args: unknown[] };

const isStr = (v: unknown) => typeof v === 'string' && v.length <= MAX_STRING;
const isBytes = (v: unknown) => v instanceof Uint8Array;
const isBytesList = (v: unknown) => Array.isArray(v) && v.length <= 4096 && v.every(isBytes);
const isEdit = (v: any) => !!v && (v.base === null || isStr(v.base) || typeof v.base === 'string') && typeof v.title === 'string' && typeof v.content === 'string' && typeof v.isPinned === 'boolean' && typeof v.isArchived === 'boolean';

// Per call: how to check the arguments.
const CALLS: Record<string, (a: unknown[]) => boolean> = {
  profiles: a => a.length === 0,
  createProfile: a => isStr(a[0]) && isStr(a[1]),
  plainNotes: a => isStr(a[0]),
  link: a => isStr(a[0]) && a[1] instanceof Map && [...a[1]].every(([k, v]) => isStr(k) && isStr(v)),
  docs: a => isStr(a[0]),
  stateVector: a => isStr(a[0]) && isStr(a[1]),
  diff: a => isStr(a[0]) && isStr(a[1]) && isBytes(a[2]),
  apply: a => isStr(a[0]) && isStr(a[1]) && isBytesList(a[2]),
  note: a => isStr(a[0]) && isStr(a[1]),
  allNotes: a => isStr(a[0]),
  applyFile: a => isStr(a[0]) && (a[1] === null || isStr(a[1])) && isEdit(a[2]),
  binNote: a => isStr(a[0]) && isStr(a[1]),
  blobs: a => isStr(a[0]),
  getBlob: a => isStr(a[0]) && isStr(a[1]),
  putBlob: a => isStr(a[0]) && isStr(a[1]) && isBytes(a[2]),
};

// Main side. Returns a function that drops every subscription (call it when the worker exits).
export const serveStore = (port: Port, store: SyncStore, log: (e: string) => void = () => {}) => {
  const subs = new Map<number, () => void>();
  let inFlight = 0;
  const reply = (m: Msg) => port.send(m);
  port.on(raw => {
    const m = raw as Msg;
    if (!m || typeof m !== 'object' || typeof m.k !== 'string' || !m.k.startsWith('s:')) return;
    if (m.k === 's:call') {
      const check = Object.hasOwn(CALLS, m.op) ? CALLS[m.op] : undefined;
      if (!check || !Array.isArray(m.args) || !check(m.args) || typeof m.id !== 'number') { log(`refused store call ${String(m.op).slice(0, 40)}`); return reply({ k: 's:ret', id: m.id, ok: false, message: 'Bad request', code: 'BAD' }); }
      if (inFlight >= MAX_IN_FLIGHT) return reply({ k: 's:ret', id: m.id, ok: false, message: 'Busy', code: 'BUSY' });
      inFlight++;
      Promise.resolve()
        .then(() => (store as unknown as Record<string, (...a: unknown[]) => unknown>)[m.op]?.(...m.args))
        .then(value => reply({ k: 's:ret', id: m.id, ok: true, value }), (e: unknown) => reply({ k: 's:ret', id: m.id, ok: false, message: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code }))
        .finally(() => { inFlight--; });
    } else if (m.k === 's:sub') {
      if (!isStr(m.syncId) || typeof m.sub !== 'number' || subs.has(m.sub) || subs.size >= 256) return;
      if (m.op === 'subscribe') subs.set(m.sub, store.subscribe(m.syncId, (doc, bytes) => port.send({ k: 's:ev', sub: m.sub, args: [doc, bytes] })));
      else if (m.op === 'onNoteChange') subs.set(m.sub, store.onNoteChange(m.syncId, uuid => port.send({ k: 's:ev', sub: m.sub, args: [uuid] })));
    } else if (m.k === 's:unsub') {
      subs.get(m.sub)?.();
      subs.delete(m.sub);
    }
  });
  return () => { for (const off of subs.values()) off(); subs.clear(); };
};

export class StoreError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

// Worker side. `timeoutMs` per call; a stopped port (`close`) fails every call waiting.
export const remoteStore = (port: Port, o: { timeoutMs?: number; blobTimeoutMs?: number; after?: (ms: number, fn: () => void) => () => void } = {}) => {
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; stop: () => void }>();
  const listeners = new Map<number, (...a: any[]) => void>();
  const after = o.after ?? ((ms, fn) => { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t); });
  let counter = 0;
  port.on(raw => {
    const m = raw as Msg;
    if (!m || typeof m !== 'object') return;
    if (m.k === 's:ret') {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      w.stop();
      if (m.ok) w.resolve(m.value); else w.reject(new StoreError(m.message, m.code));
    } else if (m.k === 's:ev') listeners.get(m.sub)?.(...(Array.isArray(m.args) ? m.args : []));
  });
  const call = (op: string, args: unknown[], ms = o.timeoutMs ?? 30_000) =>
    new Promise<any>((resolve, reject) => {
      const id = ++counter;
      const stop = after(ms, () => { waiting.delete(id); reject(new StoreError(`${op} timed out`, 'TIMEOUT')); });
      waiting.set(id, { resolve, reject, stop });
      port.send({ k: 's:call', id, op, args });
    });
  const listen = (op: 'subscribe' | 'onNoteChange', syncId: string, cb: (...a: any[]) => void) => {
    const sub = ++counter;
    listeners.set(sub, cb);
    port.send({ k: 's:sub', sub, op, syncId });
    return () => { if (listeners.delete(sub)) port.send({ k: 's:unsub', sub }); };
  };
  const blob = o.blobTimeoutMs ?? 120_000;
  const store: SyncStore = {
    profiles: () => call('profiles', []) as Promise<ProfileInfo[]>,
    createProfile: (syncId, name) => call('createProfile', [syncId, name]),
    plainNotes: syncId => call('plainNotes', [syncId]),
    link: (syncId, adopt) => call('link', [syncId, adopt]),
    docs: syncId => call('docs', [syncId]),
    stateVector: (syncId, doc) => call('stateVector', [syncId, doc]),
    diff: (syncId, doc, sv) => call('diff', [syncId, doc, sv]),
    apply: (syncId, doc, updates) => call('apply', [syncId, doc, updates]),
    subscribe: (syncId, l) => listen('subscribe', syncId, l),
    note: (syncId, uuid) => call('note', [syncId, uuid]),
    allNotes: syncId => call('allNotes', [syncId]),
    onNoteChange: (syncId, l) => listen('onNoteChange', syncId, l),
    applyFile: (syncId, uuid, e: FileEdit) => call('applyFile', [syncId, uuid, e]),
    binNote: (syncId, uuid) => call('binNote', [syncId, uuid]),
    blobs: syncId => call('blobs', [syncId]),
    getBlob: (syncId, hash) => call('getBlob', [syncId, hash], blob),
    putBlob: (syncId, hash, bytes) => call('putBlob', [syncId, hash, bytes], blob),
  };
  // The port is gone: calls waiting fail now, and listeners are forgotten.
  const closed = () => {
    for (const w of waiting.values()) { w.stop(); w.reject(new StoreError('The sync store is gone', 'GONE')); }
    waiting.clear();
    listeners.clear();
  };
  return { store, closed };
};
