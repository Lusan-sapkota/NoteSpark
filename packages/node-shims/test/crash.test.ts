// Crash injection: every SQLite call of an operation is made to fail once ("power loss": all later calls fail too,
// the open transaction is discarded when the connection closes), then the database is reopened and checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertInStep, byTitle, crdt, database, freshProfile, notes, profiles, reopen, rows, sample, sqlite, sync } from './helpers.ts';

const proto = sqlite.SQLiteDatabase.prototype as any;
let calls = 0;
let failAt = Infinity;
let dead = false;
for (const m of ['getAllAsync', 'getFirstAsync', 'runAsync', 'execAsync']) {
  const original = proto[m];
  proto[m] = function (...args: unknown[]) {
    if (dead) return Promise.reject(new Error('crashed'));
    if (++calls === failAt) { dead = true; return Promise.reject(new Error('crashed')); }
    return original.apply(this, args);
  };
}
const arm = (n: number) => { calls = 0; failAt = n; dead = false; };
const disarm = () => { failAt = Infinity; dead = false; };

const same = (a: unknown, b: unknown) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const titles = async () => byTitle(await rows());
let points = 0;

interface Scenario<C> {
  name: string;
  sync?: boolean;
  setup(): Promise<C>;
  op(c: C): Promise<unknown>;
  // Extra checks on the reopened database, given the state before and after a clean run.
  check?(c: C, before: any, after: any, state: any): Promise<void>;
}

const run = <C>(s: Scenario<C>) => test(`crash at every statement: ${s.name}`, async () => {
  const prepare = async () => { const profile = await freshProfile(s.sync ?? true); return { profile, ctx: await s.setup() }; };
  const clean = await prepare();
  const before = await titles();
  arm(Infinity);
  await s.op(clean.ctx);
  const total = calls;
  const after = await titles();
  disarm();
  assert.ok(total > 3, `only ${total} statements`);
  for (let n = 1; n <= total; n++) {
    const { profile, ctx } = await prepare();
    arm(n);
    await assert.rejects(s.op(ctx), `statement ${n} of ${total} should fail`);
    disarm();
    await reopen(profile);
    points++;
    const state = await titles();
    assert.ok(same(state, before) || same(state, after), `crash at ${n}/${total}: rows are neither before nor after\n${JSON.stringify(state)}`);
    if (s.sync ?? true) await assertInStep(`crash at ${n}/${total}`);
    await s.check?.(ctx, before, after, state);
  }
});

const three = async () => { for (const t of ['A', 'B', 'C']) await notes.saveNote(sample(t)); return (await notes.getNotes()) as any[]; };
const idOf = async (title: string) => (await database.db.getFirstAsync('SELECT id FROM notes WHERE title = ?', [title])).id;

run({ name: 'save a new note', setup: async () => {}, op: () => notes.saveNote(sample('New')) });
run({ name: 'edit a note (with version history)', setup: async () => { await three(); }, op: async () => notes.updateNote({ id: await idOf('A'), title: 'A renamed', content: 'changed', isMarkdown: true }) });
run({ name: 'bin a note', setup: async () => { await three(); }, op: async () => notes.moveNoteToBin(await idOf('A')) });
run({ name: 'restore a note', setup: async () => { await three(); await notes.moveNoteToBin(await idOf('A')); }, op: async () => notes.restoreNote(await idOf('A')) });
run({ name: 'pin a note', setup: async () => { await three(); }, op: async () => notes.setNotePinned(await idOf('A'), true) });
run({ name: 'archive a pinned note', setup: async () => { await three(); await notes.setNotePinned(await idOf('A'), true); }, op: async () => notes.setNoteArchived(await idOf('A'), true) });
run({ name: 'delete one note forever', setup: async () => { await three(); }, op: async () => notes.deleteNote(await idOf('A')) });
run({ name: 'empty the bin', setup: async () => { await three(); await notes.moveNoteToBin(await idOf('A')); await notes.moveNoteToBin(await idOf('B')); }, op: () => notes.emptyBin() });
run({ name: 'bin everything', setup: async () => { await three(); }, op: () => notes.moveAllNotesToBin() });
run({ name: 'import (merge)', setup: async () => { await three(); }, op: () => notes.importNotes([sample('A'), sample('D'), sample('E')], 'merge') });
run({ name: 'import (replace all)', setup: async () => { await three(); }, op: () => notes.importNotes([sample('D'), sample('E')], 'replace') });
run({ name: 'save with sync off', sync: false, setup: async () => { await three(); }, op: async () => notes.updateNote({ id: await idOf('A'), title: 'A', content: 'x', isMarkdown: true }) });

const fixture = async () => {
  await three();
  const remote = new sync.Replica(9001);
  remote.receive((await database.db.getAllAsync('SELECT docId, "update" FROM crdt_updates ORDER BY id')).map((r: any) => ({ doc: r.docId, bytes: r.update })));
  return remote;
};
const textOf = (title: string) => async () => (await database.db.getFirstAsync('SELECT content FROM notes WHERE title = ?', [title]))?.content;

// Remote apply: after any crash the remote change is either fully there or fully absent, never reverted by the
// reopen's reconcile, and applying it again (the hub resends) always ends with it present.
const remoteEdit = async (remote: any) => {
  const uuid = (await database.db.getFirstAsync("SELECT uuid FROM notes WHERE title = 'A'")).uuid;
  return remote.save(uuid, { ...sync.readNote(remote.docs.get(uuid)), content: 'remote edit' }).map((d: any) => ({ doc: d.doc, bytes: d.bytes }));
};
let deltas: any[] = [];
run({
  name: 'apply a remote edit',
  setup: async () => { const remote = await fixture(); deltas = await remoteEdit(remote); return remote; },
  op: () => crdt.applyRemote(database.db, deltas),
  check: async (_c, _b, _a, state) => {
    const content = await textOf('A')();
    if (state.A.content === 'remote edit') assert.equal(content, 'remote edit', 'remote change reverted');
    await crdt.applyRemote(database.db, deltas);
    assert.equal(await textOf('A')(), 'remote edit');
    await assertInStep('after re-apply');
  },
});
run({
  name: 'apply a remote erase and a remote new note',
  setup: async () => {
    const remote = await fixture();
    const uuid = (await database.db.getFirstAsync("SELECT uuid FROM notes WHERE title = 'B'")).uuid;
    deltas = [...remote.erase(uuid), ...remote.save(crypto.randomUUID(), { title: 'R', content: 'r', isMarkdown: true, isPinned: false, isArchived: false, deletedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })];
  },
  op: () => crdt.applyRemote(database.db, deltas),
  check: async () => {
    await crdt.applyRemote(database.db, deltas);
    assert.deepEqual(Object.keys(await titles()).sort(), ['A', 'C', 'R']);
  },
});

// Transfer touches two databases: after a crash in either, no note is lost from both, and each database is in step.
test('crash at every statement: transfer to another profile and undo', async () => {
  const setup = async () => {
    const target = await freshProfile(true);
    const source = await freshProfile(true);
    await three();
    return { source, target };
  };
  const readTarget = async (target: string) => {
    await database.openProfileDatabase(target);
    const t = await titles();
    await assertInStep(`target ${target}`);
    return t;
  };
  for (const undo of [false, true]) {
    let total = 0;
    for (let n = 0; n <= total; n++) {
      const { source, target } = await setup();
      const move = async () => {
        const moved = ((await notes.getNotes()) as any[]).filter(x => x.title === 'A');
        const back = await profiles.transferNotesToProfile(moved, target);
        if (undo) await back();
      };
      if (n === 0) {
        arm(Infinity);
        await move();
        total = calls;
        disarm();
        continue;
      }
      arm(n);
      await assert.rejects(move());
      disarm();
      points++;
      await reopen(source);
      const kept = await titles();
      await assertInStep(`source at ${n}/${total}`);
      const copied = await readTarget(target);
      assert.ok('A' in kept || 'A' in copied, `note lost at ${n}/${total} (undo ${undo})`);
      await database.openProfileDatabase(source);
    }
  }
});

process.on('exit', () => console.log(`crash points injected: ${points}`));
