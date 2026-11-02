import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogUpdate } from '@notespark/sync';
import { Session, backoff } from '../src/index.ts';
import { T, encodeFrame } from '../src/wire.ts';
import { World, note, rng, sha256, uuid } from './harness.ts';

// A device that links a local profile to a hub profile ('' = a new one).
const linked = async (w: World, notes: Record<string, ReturnType<typeof note>>, hubSyncId = '', over: Record<string, unknown> = {}) => {
  const d = w.device();
  for (const [u, n] of Object.entries(notes)) d.store.plain.set(u, n);
  d.start({ link: { syncId: hubSyncId, name: 'Personal' }, ...over });
  await w.run(5000);
  return d;
};

test('first link as a new profile: notes reach the hub', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One'), [uuid(2)]: note('Two') });
  assert.equal(a.client!.state, 'live');
  const syncId = a.client!.syncId!;
  assert.deepEqual(Object.values(w.hubStore.notes(syncId)).map(n => n.title).sort(), ['One', 'Two']);
});

test('adoption: identical notes are joined, different and near-identical ones stay, empty ones are never joined', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('Same'), [uuid(2)]: note('Only phone'), [uuid(3)]: note('Near', 'text A'), [uuid(4)]: note('', '') });
  const syncId = a.client!.syncId!;
  let plan: any;
  const b = await linked(w, { [uuid(11)]: note('Same'), [uuid(12)]: note('Near', 'text B'), [uuid(13)]: note('', ''), [uuid(14)]: note('Same', 'Same body\r\n') }, syncId, { confirmLink: async (p: any) => ((plan = p), true) });
  assert.equal(plan.pairs.length, 1, 'Same (twice on b, once on a) joins one copy; the second Same joins nothing');
  await w.run(5000);
  const titles = (s: any) => Object.values(s.notes(syncId)).map((n: any) => `${n.title}|${n.content}`).sort();
  assert.deepEqual(titles(w.hubStore), titles(a.store));
  assert.deepEqual(titles(b.store), titles(a.store));
  assert.equal(titles(b.store).filter(t => t.startsWith('Same|')).length, 2, 'one joined, one extra copy kept');
  assert.equal(titles(b.store).filter(t => t.startsWith('Near|')).length, 2);
  assert.equal(titles(b.store).filter(t => t === '|').length, 2, 'empty notes are separate');
  assert.ok(b.store.peek(syncId, uuid(1)), 'b adopted the hub uuid');
});

test('declining the plan changes nothing', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const b = await linked(w, { [uuid(2)]: note('One') }, a.client!.syncId!, { confirmLink: async () => false });
  assert.equal(b.store.plain.size, 1);
  assert.equal(b.store.profilesById.size, 0);
});

test('live changes go through the hub to every device, erase and bin included', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  const c = await linked(w, {}, syncId);
  a.store.edit(syncId, uuid(1), note('One', 'edited on a'));
  b.store.edit(syncId, uuid(9), note('From b'));
  await w.run(1000);
  for (const d of [a, b, c, { store: w.hubStore }]) assert.equal(d.store.peek(syncId, uuid(1))!.content, 'edited on a');
  assert.equal(c.store.peek(syncId, uuid(9))!.title, 'From b');
  c.store.erase(syncId, uuid(1));
  w.hubStore.edit(syncId, uuid(5), note('From hub'));
  await w.run(1000);
  for (const d of [a, b, c, { store: w.hubStore }]) { assert.equal(d.store.peek(syncId, uuid(1)), null); assert.equal(d.store.peek(syncId, uuid(5))!.title, 'From hub'); }
});

test('a device that was offline catches up in one exchange, and the 30 second reconcile heals a lost push', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  b.online = false;
  b.client!.session!.close('wifi off');
  for (let i = 0; i < 50; i++) a.store.edit(syncId, uuid(100 + i), note(`n${i}`));
  await w.run(10_000);
  assert.equal(Object.keys(b.store.notes(syncId)).length, 1);
  b.online = true;
  await w.run(70_000);
  assert.deepEqual(b.store.notes(syncId), a.store.notes(syncId));
  // a lost push
  w.net.faults.drop = 1;
  a.store.edit(syncId, uuid(1), note('One', 'lost push'));
  await w.run(100);
  w.net.faults.drop = 0;
  await w.run(45_000);
  assert.equal(b.store.peek(syncId, uuid(1))!.content, 'lost push');
});

test('state machine: back-off doubles to 60 s, a dead connection is noticed, 403 and 423 are reported', async () => {
  const seq = Array.from({ length: 9 }, (_, i) => backoff(i, () => 0.5));
  assert.deepEqual(seq, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  const w = new World();
  const d = await linked(w, { [uuid(1)]: note('x') });
  assert.equal(d.client!.state, 'live');
  w.net.faults.drop = 1; // silent link: dead after 45 s
  await w.run(120_000);
  assert.notEqual(d.client!.state, 'live');
  assert.ok(d.states.includes('waiting'));
  w.net.faults.drop = 0;
  await w.run(120_000);
  assert.equal(d.client!.state, 'live');
  const lost = w.device('00000000-0000-4000-8000-00000000dead');
  lost.start();
  await w.run(1000);
  assert.equal(lost.client!.state, 'notLinked');
});

test('a locked profile answers 423 and the client waits, then syncs after unlock', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  const real = w.hubStore.profiles.bind(w.hubStore);
  w.hubStore.profiles = async () => (await real()).map(p => ({ ...p, locked: true }));
  b.client!.session!.close('lock test');
  await w.run(3000);
  assert.equal(b.client!.state, 'locked');
  w.hubStore.profiles = real;
  await w.run(20_000);
  assert.equal(b.client!.state, 'live');
});

test('a hub session refuses frames before subscribing, floods of requests, and applies nothing', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const [x, y] = w.net.pair();
  let applied = 0;
  const apply = w.hubStore.apply.bind(w.hubStore);
  w.hubStore.apply = async (...args) => { applied++; return apply(...args); };
  const closed: string[] = [];
  const s = w.hub.accept(y, { onClosed: r => closed.push(r) });
  x.send(encodeFrame({ type: T.UPDATE, doc: uuid(7), id: 1, index: 0, count: 1, bytes: Uint8Array.of(1, 2, 3) }));
  await w.run(100);
  assert.equal(applied, 0);
  assert.equal(s.state, 'closed');
  const [x2, y2] = w.net.pair();
  const s2 = w.hub.accept(y2);
  x2.send(encodeFrame({ type: T.SUBSCRIBE, syncId }));
  await w.run(100);
  for (let i = 0; i < 9; i++) y2.onMessage(encodeFrame({ type: T.SV, doc: uuid(50 + i), stateVector: Uint8Array.of(0) }));
  await w.run(200);
  assert.equal(s2.state, 'closed');
  assert.equal(s2.closeCode, 400);
  assert.equal(applied, 0);
});

test('a note over 32 MB stays on its device, is reported, and everything else syncs (row 12)', async () => {
  const w = new World();
  const problems: { code: number; doc: string }[] = [];
  const a = await linked(w, { [uuid(1)]: note('Small') }, '', { onProblem: (p: { code: number; doc: string }) => problems.push(p) });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  a.store.edit(syncId, uuid(2), note('Huge', 'x'.repeat(33 * 1024 * 1024)));
  a.store.edit(syncId, uuid(3), note('Normal'));
  await w.run(70_000);
  assert.equal(b.store.peek(syncId, uuid(3))!.title, 'Normal');
  assert.equal(b.store.peek(syncId, uuid(2))?.content ?? '', '', 'the huge note never arrived');
  assert.deepEqual(problems[0], { code: 413, doc: uuid(2) });
  assert.equal(a.client!.state, 'live');
});

test('a peer that sends faster than the store can apply is cut off at 64 MB queued (429)', async () => {
  const w = new World();
  w.hubStore.profiles = () => new Promise(() => {}); // the hub never gets to the frames
  const [a, b] = w.net.pair();
  const session = w.hub.accept(b);
  const frame = encodeFrame({ type: T.SV, doc: 'catalog', stateVector: new Uint8Array(1024 * 1024 - 64) });
  for (let i = 0; i < 70 && session.state !== 'closed'; i++) a.send(frame);
  await w.run(100);
  assert.equal(session.state, 'closed');
  assert.equal(session.closeCode, 429);
});

test('a stopped client does not reconnect', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const sent = w.net.sent;
  a.client!.stop();
  await w.run(5 * 60_000);
  assert.equal(a.client!.state, 'off');
  assert.equal(w.clock.pending(), 0, 'no timer left running');
  assert.ok(w.net.sent - sent < 5);
});

test('a reference to a file nobody has is asked for a few times, then not again; once a peer offers it, it is fetched', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  const b = await linked(w, {}, syncId);
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) & 255);
  const hash = Array.from(sha256(bytes), x => x.toString(16).padStart(2, '0')).join('');
  let requests = 0;
  const pair = w.net.pair.bind(w.net);
  w.net.pair = () => {
    const ends = pair();
    for (const end of ends) { const send = end.send; end.send = d => { if (d[0] === T.BLOB_REQ) requests++; send(d); }; }
    return ends;
  };
  for (const d of [a, b]) { d.online = false; d.client!.session?.close('offline'); }
  await w.run(5000);
  for (const d of [a, b]) d.online = true;
  a.store.edit(syncId, uuid(2), note('Dangling', `[f.bin](attachment:${hash})`)); // a reference, but no file anywhere
  await w.run(5 * 60_000);
  const early = requests;
  assert.ok(early > 0 && early <= 3 * 4, `asked ${early} times`);
  await w.run(10 * 60_000);
  assert.equal(requests, early, 'it stopped asking');
  await a.store.putBlob(syncId, hash, bytes); // the file turns up on one device
  await w.run(3 * 60_000);
  assert.deepEqual(await b.store.getBlob(syncId, hash), bytes);
  assert.deepEqual(await w.hubStore.getBlob(syncId, hash), bytes);
});

test('a catalog key that is not a note uuid (from a hostile device or file) cannot stop other devices from syncing', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('One') });
  const syncId = a.client!.syncId!;
  await w.hubStore.apply(syncId, 'catalog', [catalogUpdate([], 99, { live: ['not-a-uuid'], erased: ['Not-A-UUID-either'] })!]);
  const b = await linked(w, {}, syncId);
  await w.run(60_000);
  assert.equal(b.client!.state, 'live');
  assert.equal(b.store.peek(syncId, uuid(1))!.title, 'One');
});

test('first-link rule (decision A): same name (trimmed, case-insensitive) joins and merges notes; empty phone or empty computer works', async () => {
  // 1. Same name with whitespace & case difference -> joins existing profile and merges notes
  const w1 = new World();
  const desk1 = await linked(w1, { [uuid(1)]: note('Shared'), [uuid(2)]: note('Desk only') }, '', { link: { syncId: '', name: 'Personal' } });
  const sid1 = desk1.client!.syncId!;
  const phone1 = await linked(w1, { [uuid(10)]: note('Shared'), [uuid(11)]: note('Phone only') }, '', { link: { syncId: '', name: '  personal  ' } });
  assert.equal(phone1.client!.state, 'live');
  assert.equal(phone1.client!.syncId, sid1, 'joined existing same-name profile instead of creating a second one');
  assert.equal((await w1.hubStore.profiles()).length, 1);
  assert.deepEqual(Object.values(phone1.store.notes(sid1)).map(n => n.title).sort(), ['Desk only', 'Phone only', 'Shared']);

  // 2. Empty phone profile joining populated computer profile
  const w2 = new World();
  const desk2 = await linked(w2, { [uuid(1)]: note('From computer') }, '', { link: { syncId: '', name: 'Work' } });
  const sid2 = desk2.client!.syncId!;
  const phone2 = await linked(w2, {}, '', { link: { syncId: '', name: 'work' } });
  assert.equal(phone2.client!.syncId, sid2);
  assert.deepEqual(Object.values(phone2.store.notes(sid2)).map(n => n.title), ['From computer']);

  // 3. Populated phone profile joining empty computer profile
  const w3 = new World();
  const sid3 = uuid(900);
  await w3.hubStore.createProfile(sid3, 'Study');
  const phone3 = await linked(w3, { [uuid(1)]: note('From phone') }, '', { link: { syncId: '', name: 'STUDY' } });
  assert.equal(phone3.client!.syncId, sid3);
  assert.deepEqual(Object.values(w3.hubStore.notes(sid3)).map(n => n.title), ['From phone']);
});

test('first-link rule (decision A): different name makes a new profile; several matches ask pickProfile; locked match makes a new profile and notifies', async () => {
  const w = new World();
  const sidA = uuid(801), sidB = uuid(802), sidLocked = uuid(803);
  await w.hubStore.createProfile(sidA, 'Personal');
  w.hubStore.edit(sidA, uuid(1), note('In A'));
  await w.hubStore.createProfile(sidB, 'personal');
  w.hubStore.edit(sidB, uuid(2), note('In B'));
  await w.hubStore.createProfile(sidLocked, 'Secret');
  const origProfiles = w.hubStore.profiles.bind(w.hubStore);
  w.hubStore.profiles = async () => (await origProfiles()).map(p => (p.syncId === sidLocked ? { ...p, protected: true, locked: true } : p));

  // Different name -> creates a new profile on the hub
  const diff = await linked(w, { [uuid(10)]: note('Trip') }, '', { link: { syncId: '', name: 'Travel' } });
  assert.equal(diff.client!.state, 'live');
  assert.ok(![sidA, sidB, sidLocked].includes(diff.client!.syncId!));

  // Several matches -> calls pickProfile; choosing sidB links to sidB
  let offered: string[] = [];
  const multi = await linked(w, { [uuid(20)]: note('Picked') }, '', {
    link: { syncId: '', name: 'Personal' },
    pickProfile: async candidates => { offered = candidates.map(c => c.syncId); return sidB; },
  });
  assert.deepEqual(offered, [sidA, sidB]);
  assert.equal(multi.client!.syncId, sidB);
  assert.deepEqual(Object.values(multi.store.notes(sidB)).map(n => n.title).sort(), ['In B', 'Picked']);

  // Locked match -> does NOT match sidLocked; creates a new profile and fires onLockedMatch
  let lockedNoticed = '';
  const lockedPhone = await linked(w, { [uuid(30)]: note('Safe') }, '', {
    link: { syncId: '', name: 'secret' },
    onLockedMatch: name => { lockedNoticed = name; },
  });
  assert.equal(lockedNoticed, 'Secret');
  assert.equal(lockedPhone.client!.state, 'live');
  assert.notEqual(lockedPhone.client!.syncId, sidLocked);
});

test('first-link rule (decision A): acceptNew off refuses creating a new profile (403 new profiles off) but allows joining an existing same-name profile', async () => {
  const w = new World();
  const sid = uuid(700);
  await w.hubStore.createProfile(sid, 'Personal');
  w.hubStore.edit(sid, uuid(1), note('Desk note'));
  let acceptNew = false;
  const origCreate = w.hubStore.createProfile.bind(w.hubStore);
  w.hubStore.createProfile = async (id, name) => {
    if (!acceptNew) throw Object.assign(new Error('This computer does not accept new profiles from devices.'), { code: 'NEW_REFUSED' });
    return origCreate(id, name);
  };

  // Joining existing same-name profile works even when acceptNew is false
  const joiner = await linked(w, { [uuid(2)]: note('Phone note') }, '', { link: { syncId: '', name: 'Personal' } });
  assert.equal(joiner.client!.state, 'live');
  assert.equal(joiner.client!.syncId, sid);

  // Creating a new profile with a different name is refused with 403 'new profiles off' and stops retrying
  const maker = w.device();
  maker.store.plain.set(uuid(3), note('Novel'));
  maker.start({ link: { syncId: '', name: 'Recipes' } });
  await w.run(5000);
  assert.equal(maker.client!.state, 'notLinked');
  assert.equal(maker.client!.closeCode, 403);
  assert.equal(maker.client!.closeReason, 'new profiles off');

  // Once the user turns acceptNew on and nudges, it links and syncs
  acceptNew = true;
  maker.client!.nudge();
  await w.run(5000);
  assert.equal(maker.client!.state, 'live');
  assert.equal(w.hubStore.peek(maker.client!.syncId!, uuid(3))?.title, 'Novel');
});

test('kill or disconnect in the middle of first-time linking is idempotent (reuses newId, no duplicate profiles or notes)', async () => {
  const w = new World();
  let dropConfirm = true;
  const origPair = w.net.pair.bind(w.net);
  w.net.pair = () => {
    const [a, b] = origPair();
    const origSend = a.send.bind(a);
    a.send = d => {
      if (dropConfirm && d[0] === T.LINK_CONFIRM) {
        dropConfirm = false;
        a.close();
        return;
      }
      origSend(d);
    };
    return [a, b];
  };
  const d = await linked(w, { [uuid(1)]: note('Once only') }, '', { link: { syncId: '', name: 'NewOne' } });
  await w.run(15_000);
  assert.equal(d.client!.state, 'live');
  const profiles = await w.hubStore.profiles();
  assert.equal(profiles.length, 1, 'only one profile created on the hub across the interrupted attempt and retry');
  assert.equal(Object.keys(w.hubStore.notes(profiles[0].syncId)).length, 1);
});

test('delete profile on hub then reconnect -> 403 notLinked; unlink + reconnect recreates the profile and restores all notes (I8); rename keeps syncing; hub.stop sends 503', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('Survivor'), [uuid(2)]: note('Second') }, '', { link: { syncId: '', name: 'Journal' } });
  const firstSid = a.client!.syncId!;
  assert.equal(a.client!.state, 'live');

  // Renaming on the hub does not break sync (syncs by syncId)
  const info = w.hubStore.profilesById.get(firstSid)!;
  info.name = 'Renamed on Computer';
  a.store.edit(firstSid, uuid(1), note('Survivor', 'updated after rename'));
  await w.run(2000);
  assert.equal(w.hubStore.peek(firstSid, uuid(1))?.content, 'updated after rename');

  // Hub stops cleanly -> client sees 503 'shutting down'
  w.hub.stop();
  await w.run(100);
  assert.equal(a.client!.closeCode, 503);
  assert.equal(a.client!.closeReason, 'shutting down');

  // Profile deleted on the hub -> reconnect sees 403 'profile not linked' (notLinked)
  w.hubStore.profilesById.delete(firstSid);
  a.client!.nudge();
  await w.run(2000);
  assert.equal(a.client!.state, 'notLinked');
  assert.equal(a.client!.closeCode, 403);
  assert.equal(a.client!.closeReason, 'profile not linked');

  // Recovery: unlink local store and restart with link { syncId: '', name: 'Journal' } -> recreates on hub with all notes intact (I8)
  a.client!.stop();
  await a.store.unlink(firstSid);
  a.syncId = undefined;
  a.start({ link: { syncId: '', name: 'Journal' } });
  await w.run(5000);
  assert.equal(a.client!.state, 'live');
  const secondSid = a.client!.syncId!;
  assert.notEqual(secondSid, firstSid);
  assert.deepEqual(Object.values(w.hubStore.notes(secondSid)).map(n => n.title).sort(), ['Second', 'Survivor']);
  assert.equal(w.hubStore.peek(secondSid, uuid(1))?.content, 'updated after rename');

  // Also verify relinkIfMissing (used after re-pairing when hub data folder was wiped): re-links under the existing syncId
  const wipedHub = new World();
  const client2 = wipedHub.device(secondSid);
  client2.store = a.store;
  client2.start({ syncId: secondSid, link: { syncId: '', name: 'Journal' }, relinkIfMissing: true });
  await wipedHub.run(5000);
  assert.equal(client2.client!.state, 'live');
  assert.equal(client2.client!.syncId, secondSid);
  assert.deepEqual(Object.values(wipedHub.hubStore.notes(secondSid)).map(n => n.title).sort(), ['Second', 'Survivor']);
});

test('mid-session lock on the hub returns 423 and transitions client to locked without losing edits', async () => {
  const w = new World();
  const a = await linked(w, { [uuid(1)]: note('Before lock') });
  const syncId = a.client!.syncId!;
  assert.equal(a.client!.state, 'live');

  let isLocked = true;
  const origApply = w.hubStore.apply.bind(w.hubStore);
  const origProfiles = w.hubStore.profiles.bind(w.hubStore);
  w.hubStore.apply = async (...args) => {
    if (isLocked) throw Object.assign(new Error('Profile is locked'), { code: 'LOCKED' });
    return origApply(...args);
  };
  w.hubStore.profiles = async () => (await origProfiles()).map(p => ({ ...p, locked: isLocked }));

  a.store.edit(syncId, uuid(2), note('While locked'));
  await w.run(2000);
  assert.equal(a.client!.state, 'locked');
  assert.equal(a.client!.closeCode, 423);

  isLocked = false;
  a.client!.nudge();
  await w.run(5000);
  assert.equal(a.client!.state, 'live');
  assert.equal(w.hubStore.peek(syncId, uuid(2))?.title, 'While locked');
});

test('property: two clients and one hub with random disconnects, edits, bins, erases, and profile wipe+relink converge with zero lost acknowledged writes (I1, I2, I5, I8)', async () => {
  for (let seed = 1; seed <= 5; seed++) {
    const w = new World(seed);
    const rand = rng(seed * 97);
    const a = await linked(w, { [uuid(1)]: note('Seed0') }, '', { link: { syncId: '', name: 'Shared' } });
    let syncId = a.client!.syncId!;
    const b = await linked(w, {}, syncId, { link: { syncId, name: 'Shared' } });

    const ackedTitles = new Map<string, string>(); // uuid -> latest title edited while live or kept across steps
    const erased = new Set<string>();
    ackedTitles.set(uuid(1), 'Seed0');

    for (let step = 0; step < 30; step++) {
      const pick = rand();
      const dev = rand() < 0.5 ? a : b;
      const docId = uuid(1 + Math.floor(rand() * 8));
      if (pick < 0.45 && !erased.has(docId)) {
        const title = `T-${seed}-${step}`;
        const binned = rand() < 0.2 ? '2026-01-02T00:00:00.000Z' : null;
        dev.store.edit(syncId, docId, note(title, `body ${step}`, { deletedAt: binned }));
        ackedTitles.set(docId, title);
      } else if (pick < 0.6 && ackedTitles.size > 1) {
        dev.store.erase(syncId, docId);
        erased.add(docId);
        ackedTitles.delete(docId);
      } else if (pick < 0.8) {
        dev.online = !dev.online;
        if (!dev.online) dev.client?.session?.close('random drop');
      } else {
        w.net.faults.drop = rand() < 0.3 ? 0.2 : 0;
      }
      await w.run(1500);
    }

    // Bring everyone online with clean network and converge
    w.net.faults.drop = 0;
    a.online = true;
    b.online = true;
    a.client!.nudge();
    b.client!.nudge();
    await w.run(90_000);

    assert.equal(a.client!.state, 'live', `seed ${seed} client a live`);
    assert.equal(b.client!.state, 'live', `seed ${seed} client b live`);
    assert.deepEqual(a.store.notes(syncId), w.hubStore.notes(syncId), `seed ${seed} a == hub (I2)`);
    assert.deepEqual(b.store.notes(syncId), w.hubStore.notes(syncId), `seed ${seed} b == hub (I2)`);

    // Every non-erased note is present on all 3 stores (I1), every erased note is gone (I5)
    for (const u of erased) assert.equal(w.hubStore.peek(syncId, u), null, `seed ${seed} erased ${u} stays gone (I5)`);
    for (const u of ackedTitles.keys()) assert.ok(w.hubStore.peek(syncId, u), `seed ${seed} note ${u} preserved (I1)`);

    // Simulate hub profile deletion + client a re-linking (I8): all surviving notes are restored to the hub
    const beforeWipe = w.hubStore.notes(syncId);
    w.hubStore.profilesById.delete(syncId);
    a.client!.session?.close('hub wiped');
    await w.run(3000);
    assert.equal(a.client!.state, 'notLinked');
    a.client!.stop();
    await a.store.unlink(syncId);
    a.syncId = undefined;
    a.start({ link: { syncId: '', name: 'Shared' } });
    await w.run(10_000);
    assert.equal(a.client!.state, 'live');
    syncId = a.client!.syncId!;
    assert.deepEqual(w.hubStore.notes(syncId), beforeWipe, `seed ${seed} re-link restored every note to hub (I8)`);
  }
});
