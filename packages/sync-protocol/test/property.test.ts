// Random edits, offline, restarts and a faulty network on 3 to 5 devices and a hub; after healing all must converge (I2). SEEDS=n, SEED=n.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore, type NoteState } from '@notespark/sync';
import { Hub } from '../src/index.ts';
import { type Device, World, note, sha256, uuid } from './harness.ts';

const run = async (seed: number) => {
  const w = new World(seed);
  const r = w.rng;
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const alive = new Set<string>(); // created after linking, not erased
  const erased = new Set<string>();
  const created = new Map<string, string>();
  let counter = 1000 * seed;
  // never inside a surrogate pair (Yjs stores text as UTF-8, a lone half would not survive)
  const edge = (t: string, i: number) => (i > 0 && i < t.length && t.charCodeAt(i) >= 0xdc00 && t.charCodeAt(i) <= 0xdfff ? i - 1 : i);
  const word = () => pick(['a', 'bc', ' ', '\n', 'é', '😀', 'xyz', '# ', 'q']);

  const faultyLink = r() < 0.3;
  if (faultyLink) w.net.faults = { drop: 0.02, duplicate: 0.05, delayMax: 50, cut: 0.01 };
  const first = w.device();
  const seedNotes = Array.from({ length: Math.floor(r() * 4) }, () => note(`Seed ${counter}`, `body ${counter++}`));
  seedNotes.forEach((n, i) => first.store.plain.set(uuid(seed * 100 + i), n));
  first.start({ link: { syncId: '', name: 'Personal' } });
  for (let i = 0; i < 40 && first.client!.state !== 'live'; i++) await w.run(8000);
  const count = 3 + Math.floor(r() * 3);
  for (let i = 1; i < count; i++) {
    const d = w.device();
    seedNotes.filter(() => r() < 0.6).forEach((n, k) => d.store.plain.set(uuid(seed * 100 + 50 + i * 10 + k), { ...n }));
    if (r() < 0.5) d.store.plain.set(uuid(seed * 100 + 90 + i), note(`Own ${i}`, 'x'));
    const syncId = w.devices[0].client?.syncId ?? [...w.hubStore.profilesById.keys()][0];
    d.start({ link: { syncId, name: '' } });
  }
  w.net.faults = { drop: 0, duplicate: 0, delayMax: 0, cut: 0 };
  await w.run(20_000);
  const syncId = [...w.hubStore.profilesById.keys()][0];
  assert.ok(syncId, 'the hub has the profile');
  const skew = w.devices.map(() => Math.floor((r() - 0.5) * 6e8)); // clock skew

  const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1) + w.clock.time + skew[i]).toISOString();
  const stores = (): (MemoryStore | null)[] => [w.hubStore, ...w.devices.map(d => (d.store.profilesById.has(syncId) ? d.store : null))];

  const steps = 30 + Math.floor(r() * 90);
  for (let s = 0; s < steps; s++) {
    const op = r();
    const at = Math.floor(r() * (w.devices.length + 1)); // 0 is the hub
    const store = stores()[at];
    const stampNow = at === 0 ? stamp(0) : stamp(at - 1);
    if (op < 0.55 && store) {
      const have = Object.keys(store.notes(syncId));
      const create = have.length === 0 || r() < 0.2;
      const id = create ? uuid(500_000 + counter++) : pick(have);
      const cur: NoteState = create ? note(`N${counter}`, '', { createdAt: stampNow }) : store.peek(syncId, id)!;
      const kind = create ? 'content' : pick(['content', 'content', 'title', 'pin', 'archive', 'bin', 'markdown']);
      const next = { ...cur, updatedAt: stampNow };
      if (kind === 'content') { const i = edge(cur.content, Math.floor(r() * (cur.content.length + 1))); next.content = cur.content.slice(0, i) + word() + cur.content.slice(edge(cur.content, i + Math.floor(r() * 3))); }
      else if (kind === 'title') { const i = edge(cur.title, Math.floor(r() * (cur.title.length + 1))); next.title = cur.title.slice(0, i) + word() + cur.title.slice(edge(cur.title, i + Math.floor(r() * 2))); }
      else if (kind === 'pin') next.isPinned = !cur.isPinned;
      else if (kind === 'archive') next.isArchived = !cur.isArchived;
      else if (kind === 'bin') next.deletedAt = cur.deletedAt ? null : stampNow;
      else next.isMarkdown = !cur.isMarkdown;
      store.edit(syncId, id, next);
      if (create) { alive.add(id); created.set(id, `step ${s} at ${at} t=${w.clock.time}`); }
    } else if (op < 0.63 && store) {
      const have = Object.keys(store.notes(syncId));
      if (have.length) { const id = pick(have); store.erase(syncId, id); alive.delete(id); erased.add(id); }
    } else if (op < 0.71 && at > 0) {
      const d = w.devices[at - 1];
      d.online = !d.online;
      if (!d.online) d.client?.session?.close('offline');
    } else if (op < 0.76 && at > 0) {
      w.devices[at - 1].restart(7000 + counter++);
    } else if (op < 0.79) {
      w.hub.stop();
      w.hubStore = MemoryStore.restore(900 + counter++, w.hubStore.snapshot());
      w.hub = new Hub(w.hubStore, w.clock, sha256);
    } else if (op < 0.85) {
      w.net.faults = r() < 0.5 ? { drop: 0, duplicate: 0, delayMax: 0, cut: 0 } : { drop: r() * 0.05, duplicate: r() * 0.1, delayMax: Math.floor(r() * 3000), cut: r() * 0.03 };
    } else {
      await w.run(Math.floor(r() < 0.05 ? 4 * 3_600_000 * r() : r() * 20_000));
    }
    await w.run(Math.floor(r() * 500));
  }

  // heal
  w.net.faults = { drop: 0, duplicate: 0, delayMax: 0, cut: 0 };
  for (const d of w.devices) d.online = true;
  const view = (st: MemoryStore) => JSON.stringify([st.notes(syncId), st.erasedSet(syncId)]);
  let ok = false;
  for (let t = 0; t < 40 && !ok; t++) {
    await w.run(30_000);
    ok = w.devices.every(d => d.store.profilesById.has(syncId) && view(d.store) === view(w.hubStore));
  }
  if (!ok) for (const [i, d] of w.devices.entries()) console.error(`device ${i}: ${d.client!.state} profile=${d.store.profilesById.has(syncId)} same=${d.store.profilesById.has(syncId) && view(d.store) === view(w.hubStore)} plain=${d.store.plain.size} states=${d.states.slice(-6)}`);
  if (!ok) for (const [i, d] of w.devices.entries()) if (d.store.profilesById.has(syncId) && view(d.store) !== view(w.hubStore)) {
    const a = d.store.notes(syncId), b = w.hubStore.notes(syncId);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error(`dev${i} ${k}\n  dev: ${JSON.stringify(a[k])}\n  hub: ${JSON.stringify(b[k])}`);
    console.error(`hub sessions: ${[...w.hub.sessions].map(x => x.state + '/' + x.syncId.slice(0, 4)).join(' ')}; dev session ${d.client!.session?.state}; hub now ${w.clock.time}`);
    console.error('erased dev', d.store.erasedSet(syncId), 'hub', w.hubStore.erasedSet(syncId));
  }
  assert.ok(ok, 'all devices hold the hub\'s notes');
  await w.run(120_000);
  assert.ok(w.devices.every(d => d.store.profilesById.has(syncId) && view(d.store) === view(w.hubStore)), 'still converged');
  assert.ok(w.devices.every(d => d.client!.state === 'live'), `every device is live: ${w.devices.map(d => d.client!.state)}`);
  const final = new Set(Object.keys(w.hubStore.notes(syncId)));
  for (const id of alive) if (!final.has(id)) console.error(`lost ${id}: hub erased=${w.hubStore.erasedSet(syncId).includes(id)} docs=${[w.hubStore, ...w.devices.map(d => d.store)].map(st => st.profilesById.get(syncId)?.replica.docs.has(id))} created=${created.get(id)}`);
  for (const id of alive) assert.ok(final.has(id), `note ${id} was lost`);
  for (const id of erased) assert.ok(!final.has(id), `erased note ${id} came back`);
  w.hub.stop();
  for (const d of w.devices) d.client?.stop();
};

const seeds = process.env.SEED ? [Number(process.env.SEED)] : Array.from({ length: Number(process.env.SEEDS ?? 100) }, (_, i) => i + 1);
test(`property: ${seeds.length} seeded runs with faults converge (SEED=n replays one)`, { timeout: 3_600_000 }, async () => {
  for (const seed of seeds) {
    try { await run(seed); } catch (e) { console.error(`FAILED seed ${seed}`); throw e; }
  }
});
