import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { COMPACT_BYTES, COMPACT_UPDATES, catalogUuids, type NoteState, Replica, applyTextDiff, compact, docFromUpdates, needsCompaction, readNote, writeNote } from '../src/index.ts';

const T = '2026-01-01T00:00:00.000Z';
const note = (over: Partial<NoteState> = {}): NoteState => ({
  title: 'Title', content: 'Hello world', isMarkdown: true, isPinned: false, isArchived: false, deletedAt: null, createdAt: T, updatedAt: T, ...over,
});

// Seeded generator: a failure prints its seed, and SEED=<n> replays it.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Three replicas that have the same note, then go apart.
const trio = (state = note()) => {
  const [a, b, c] = [new Replica(1), new Replica(2), new Replica(3)];
  a.save('n', state);
  a.syncWith(b);
  a.syncWith(c);
  return { a, b, c };
};
const meetAll = (...r: Replica[]) => {
  for (let i = 0; i < 2; i++) for (const x of r) for (const y of r) if (x !== y) x.syncWith(y);
};
const same = (...r: Replica[]) => r.slice(1).forEach(x => assert.deepEqual(x.notes(), r[0].notes()));

test('diff: only the changed middle goes into the text, surrogate pairs stay whole', () => {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.insert(0, 'a😀b😀c');
  const next = 'a😁b😀c';
  const before = Y.encodeStateVector(doc);
  assert.ok(applyTextDiff(text, next));
  assert.equal(text.toString(), next);
  assert.ok(!applyTextDiff(text, next));
  assert.ok(Y.encodeStateAsUpdate(doc, before).length < Y.encodeStateAsUpdate(doc).length);
});

test('diff: any old and new text give the new text', () => {
  const r = rng(7);
  const alphabet = ['a', 'b', ' ', '\n', '😀', 'é'];
  const word = () => Array.from({ length: Math.floor(r() * 12) }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
  for (let i = 0; i < 3000; i++) {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, word());
    const next = word();
    applyTextDiff(text, next);
    assert.equal(text.toString(), next, `run ${i}`);
  }
});

test('concurrent insert and delete in the same paragraph both survive', () => {
  const { a, b, c } = trio(note({ content: 'The quick brown fox jumps' }));
  a.save('n', note({ content: 'The very quick brown fox jumps' }));
  b.save('n', note({ content: 'The quick fox jumps' })); // deletes "brown "
  c.save('n', note({ content: 'The quick brown fox jumps over' }));
  meetAll(a, b, c);
  same(a, b, c);
  assert.equal(a.notes().n.content, 'The very quick fox jumps over');
});

test('renaming while another device edits the body keeps both', () => {
  const { a, b } = trio();
  a.save('n', note({ title: 'New title' }));
  b.save('n', note({ content: 'Hello brave world' }));
  meetAll(a, b);
  same(a, b);
  assert.equal(a.notes().n.title, 'New title');
  assert.equal(a.notes().n.content, 'Hello brave world');
});

test('deleting to the bin versus editing: the edit is kept, the note is in the bin', () => {
  const { a, b } = trio();
  a.save('n', note({ deletedAt: T }));
  b.save('n', note({ content: 'Hello edited world' }));
  meetAll(a, b);
  same(a, b);
  assert.equal(a.notes().n.deletedAt, T);
  assert.equal(a.notes().n.content, 'Hello edited world');
});

test('erasing for good versus editing: the note is gone everywhere and stays gone', () => {
  const { a, b, c } = trio();
  a.erase('n');
  b.save('n', note({ content: 'edited offline' }));
  meetAll(a, b, c);
  same(a, b, c);
  assert.deepEqual(a.notes(), {});
  assert.equal(b.docs.size, 0);
  // A late save on a device that hasn't heard of the erase can't bring it back once it has.
  assert.deepEqual(b.save('n', note({ content: 'again' })), []);
});

test('pin versus archive at the same time: archived wins, never both', () => {
  const { a, b } = trio();
  a.save('n', note({ isPinned: true }));
  b.save('n', note({ isArchived: true }));
  meetAll(a, b);
  same(a, b);
  assert.deepEqual([a.notes().n.isPinned, a.notes().n.isArchived], [false, true]);
});

test('pin and unpin from two devices converge', () => {
  const { a, b } = trio();
  a.save('n', note({ isPinned: true }));
  b.save('n', note({ isPinned: false, updatedAt: '2026-02-01T00:00:00.000Z' }));
  meetAll(a, b);
  same(a, b);
});

test('compaction at the thresholds keeps the state and sheds deleted text', () => {
  const updates: Uint8Array[] = [];
  const doc = new Y.Doc();
  doc.on('update', (u: Uint8Array) => updates.push(u));
  const text = doc.getText('body');
  for (let i = 0; i < COMPACT_UPDATES - 1; i++) text.insert(text.length, 'x');
  assert.ok(!needsCompaction(updates));
  text.insert(0, 'y');
  assert.ok(needsCompaction(updates));
  assert.ok(needsCompaction([new Uint8Array(COMPACT_BYTES)]));
  assert.ok(!needsCompaction([new Uint8Array(COMPACT_BYTES - 1)]));

  text.delete(0, text.length);
  const merged = Y.mergeUpdates(updates);
  const one = compact(updates);
  assert.ok(one.length < merged.length);
  assert.equal(docFromUpdates([one]).getText('body').toString(), '');

  // A peer that has only some of the old updates still catches up from the compacted one.
  const peer = docFromUpdates(updates.slice(0, 50));
  Y.applyUpdate(peer, one);
  assert.equal(peer.getText('body').toString(), text.toString());
});

test('an update applied twice or out of order gives the same note', () => {
  const origin = new Replica(1);
  const deltas = [
    ...origin.save('n', note()),
    ...origin.save('n', note({ content: 'Hello world!' })),
    ...origin.save('n', note({ title: 'Renamed', content: 'Hello, world!' })),
    ...origin.save('n', note({ title: 'Renamed', content: 'Hello, world!', isPinned: true })),
  ];
  const r = rng(11);
  for (let run = 0; run < 200; run++) {
    const shuffled = [...deltas, ...deltas.filter(() => r() < 0.5)].sort(() => r() - 0.5);
    const other = new Replica(9);
    other.receive(shuffled);
    assert.deepEqual(other.notes(), origin.notes(), `run ${run}`);
  }
});

test('a replica offline for a long time catches up and its edits survive', () => {
  const { a, b, c } = trio();
  for (let i = 0; i < 300; i++) {
    a.save('n', note({ content: `Hello world ${i}` }));
    a.syncWith(b);
  }
  c.save('n', note({ title: 'Offline title' }));
  c.save('m', note({ title: 'Made offline', content: 'new' }));
  meetAll(a, b, c);
  same(a, b, c);
  assert.equal(a.notes().n.title, 'Offline title');
  assert.equal(a.notes().n.content, 'Hello world 299');
  assert.equal(Object.keys(a.notes()).length, 2);
});

test('writeNote returns null when nothing changed', () => {
  const doc = new Y.Doc();
  assert.ok(writeNote(doc, note()));
  assert.equal(writeNote(doc, note()), null);
  assert.deepEqual(readNote(doc), note());
});

// Three replicas, random edits, going offline and online: after everyone meets they hold the same notes.
const WORDS = ['alpha', 'beta', 'gamma', '\n', ' ', '😀', 'é'];
const scenario = (seed: number) => {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const reps = [new Replica(seed * 3 + 1), new Replica(seed * 3 + 2), new Replica(seed * 3 + 3)];
  const online = new Set<number>([0, 1, 2]);
  const uuids = ['u1', 'u2', 'u3'];
  let clock = 0;
  const push = (i: number) => {
    for (const j of online) if (j !== i && online.has(i)) reps[i].syncWith(reps[j]);
  };
  for (let step = 0; step < 40; step++) {
    const i = Math.floor(r() * 3);
    const rep = reps[i];
    const uuid = pick(uuids);
    const now = new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
    const have = rep.notes()[uuid];
    const op = r();
    if (op < 0.1) {
      online.has(i) ? online.delete(i) : online.add(i);
    } else if (op < 0.2 && online.size > 1) {
      push(i);
    } else if (op < 0.25) {
      rep.erase(uuid);
    } else {
      const base = have ?? note({ content: '', title: '', createdAt: now });
      const next = { ...base, updatedAt: now };
      const kind = r();
      if (kind < 0.55) {
        // Whole characters only: a lone surrogate half is stored as U+FFFD by Yjs (UTF-8), which the editor never produces.
        const chars = [...base.content];
        const at = Math.floor(r() * (chars.length + 1));
        const cut = Math.floor(r() * 4);
        next.content = chars.slice(0, at).join('') + pick(WORDS) + chars.slice(at + cut).join('');
      } else if (kind < 0.7) next.title = base.title + pick(WORDS);
      else if (kind < 0.8) next.isPinned = !base.isPinned;
      else if (kind < 0.9) next.isArchived = !base.isArchived;
      else next.deletedAt = base.deletedAt ? null : now;
      rep.save(uuid, next);
    }
    push(i);
  }
  meetAll(...reps);
  return reps;
};

const SEEDS = Number(process.env.SEEDS ?? 3000);
test(`property: ${SEEDS} seeded runs of three replicas converge (SEED=n replays one)`, () => {
  const seeds = process.env.SEED ? [Number(process.env.SEED)] : Array.from({ length: SEEDS }, (_, i) => i + 1);
  for (const seed of seeds) {
    try {
      const [a, b, c] = scenario(seed);
      assert.deepEqual(b.notes(), a.notes());
      assert.deepEqual(c.notes(), a.notes());
      assert.deepEqual(catalogUuids(b.catalog).sort(), catalogUuids(a.catalog).sort());
      for (const n of Object.values(a.notes())) assert.ok(!(n.isPinned && n.isArchived));
    } catch (error) {
      console.error(`FAILED seed ${seed}: replay with SEED=${seed} npm test`);
      throw error;
    }
  }
});

test('store: updates kept as rows rebuild the note, the catalog and its tombstones', async () => {
  const { noteUpdate, noteFromUpdates, catalogUpdate, readCatalog } = await import('../src/index.ts');
  const rows: Uint8Array[] = [];
  for (const state of [note(), note({ content: 'Hello again' }), note({ content: 'Hello again', isPinned: true })]) {
    const u = noteUpdate(rows, 5, state);
    assert.ok(u);
    rows.push(u);
  }
  assert.equal(noteUpdate(rows, 5, note({ content: 'Hello again', isPinned: true })), null);
  // One client id for all of this device's updates, however often the doc is rebuilt.
  const ids = new Set(rows.map(u => Y.decodeUpdate(u).structs.map(s => s.id.client)).flat());
  assert.deepEqual([...ids], [5]);
  assert.deepEqual(noteFromUpdates(rows), note({ content: 'Hello again', isPinned: true }));

  const catalog: Uint8Array[] = [];
  catalog.push(catalogUpdate(catalog, 5, { live: ['a', 'b'] })!);
  assert.equal(catalogUpdate(catalog, 5, { live: ['a'] }), null);
  catalog.push(catalogUpdate(catalog, 5, { erased: ['b'] })!);
  const { erased, known } = readCatalog(catalog);
  assert.deepEqual([[...erased], [...known].sort()], [['b'], ['a', 'b']]);
});
