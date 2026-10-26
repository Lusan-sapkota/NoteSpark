// The phone's storage code on the Node shims, one temp folder per test file.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const warnings: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); warn(...a); };

process.env.NOTESPARK_DIR = mkdtempSync(join(tmpdir(), 'notespark-test-'));

const src = new URL('../../../Mobile/src/storage/', import.meta.url).href;
export const database = await import(`${src}database.ts`);
export const notes = await import(`${src}notes.ts`);
export const profiles = await import(`${src}profiles.ts`);
export const crdt = await import(`${src}crdt.ts`);
export const attachments = await import(`${src}attachments.ts`);
export const sync = await import('@notespark/sync');
export const sqlite = await import('expo-sqlite');

let n = 0;
export const freshProfile = async (syncOn = false) => {
  const id = `t${++n}`;
  await database.openProfileDatabase(id);
  if (syncOn) await crdt.enableSync(database.db);
  return id;
};
// A process restart: close (dropping any open transaction) and open again.
export const reopen = async (id: string) => {
  await database.closeProfileDatabase(id);
  await database.openProfileDatabase(id);
};

export const byTitle = (r: Record<string, any>) => Object.fromEntries(Object.values(r).map(v => [v.title, v]));

export const rows = async (): Promise<Record<string, any>> => {
  const all = await database.db.getAllAsync('SELECT * FROM notes ORDER BY uuid');
  return Object.fromEntries(all.map((r: any) => [r.uuid, { title: r.title, content: r.content, isMarkdown: r.isMarkdown, isPinned: r.isPinned, isArchived: r.isArchived, binned: r.deletedAt !== null }]));
};

export const docs = async () => {
  const db = database.db;
  const all = await db.getAllAsync('SELECT docId, "update" FROM crdt_updates ORDER BY id');
  const by = new Map<string, Uint8Array[]>();
  for (const r of all) by.set(r.docId, [...(by.get(r.docId) ?? []), r.update]);
  const cat = sync.readCatalog(by.get('catalog') ?? []);
  const state: Record<string, any> = {};
  for (const [uuid, u] of by) if (uuid !== 'catalog') { const s = sync.noteFromUpdates(u); state[uuid] = { title: s.title, content: s.content, isMarkdown: Number(s.isMarkdown), isPinned: Number(s.isPinned), isArchived: Number(s.isArchived), binned: s.deletedAt !== null }; }
  return { state, erased: cat.erased, known: cat.known };
};

// Every row has a doc with the same content, and nothing erased has a row.
export const assertInStep = async (label = '') => {
  const [r, d] = [await rows(), await docs()];
  const assert = (await import('node:assert/strict')).default;
  assert.deepEqual(d.state, r, `rows and docs differ ${label}`);
  for (const uuid of Object.keys(r)) assert.ok(!d.erased.has(uuid), `erased note still has a row ${label}`);
};

export const T = '2026-01-01T00:00:00.000Z';
export const sample = (title: string, over: Record<string, unknown> = {}) => ({ title, content: `${title} body`, isMarkdown: true, createdAt: T, updatedAt: T, ...over });
