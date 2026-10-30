// The desktop's sync, end to end without a window: SyncHub (main side, real storage on the shims) + the hub process (a forked child)
// + a "phone" (a second profile with its own database and a real Client) over real sockets, with every byte on the wire captured.
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { attachments, crdt, database, notes, profiles, sample } from './helpers.ts';

const { SyncHub } = await import('../../../desktop/src/main/syncHub.ts');
const { fromProcess, wsConnector } = await import('@notespark/hub');
const { Client, generateKeypair, parsePairing } = await import('@notespark/sync-protocol');
const { storageStore } = await import('../../../mobile/src/storage/syncStore.ts');
const { createHash } = await import('node:crypto');

const dir = process.env.NOTESPARK_DIR!;
const register = new URL('./loader/register.mjs', import.meta.url).href;
const entry = new URL('../../hub/test/worker-entry.ts', import.meta.url).pathname;
const children: ChildProcess[] = [];
const spawn = () => {
  const c = fork(entry, [], { serialization: 'advanced', execArgv: ['--import', register], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  children.push(c);
  c.on('error', () => {});
  return { port: fromProcess(c), kill: () => void c.kill('SIGKILL'), onExit: (cb: () => void) => void c.on('exit', cb) };
};
const signal = (c: ChildProcess) => { if (!c.pid || c.pid <= 1 || !children.includes(c)) throw new Error('refusing'); process.kill(c.pid, 'SIGKILL'); };
const freePort = () => new Promise<number>(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
const until = async (fn: () => boolean | Promise<boolean>, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); }
};
const titles = async (db: any) => (await db.getAllAsync('SELECT title, content FROM notes ORDER BY title')).map((r: any) => `${r.title}|${r.content}`);
const mode = (p: string) => statSync(p).mode & 0o777;

const relay = async (target: number) => {
  const captured: Buffer[] = [];
  const server = net.createServer(client => {
    const up = net.connect(target, '127.0.0.1');
    const end = () => { client.destroy(); up.destroy(); };
    client.on('data', d => { captured.push(Buffer.from(d)); up.write(d); }); up.on('data', d => { captured.push(Buffer.from(d)); client.write(d); });
    client.on('close', end); up.on('close', end); client.on('error', () => {}); up.on('error', () => {});
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as net.AddressInfo).port, bytes: () => Buffer.concat(captured), close: () => server.close() };
};

const MARK = 'ZZMARKERTEXT';
test('pair, sync notes, an erase and an attachment reference both ways; the hub process is killed and restarts; a revoke closes the device; nothing readable on the wire', async () => {
  const desk = await profiles.addProfile('Desk');
  const phone = await profiles.addProfile('Phone');
  await database.openProfileDatabase(phone.id);
  await notes.saveNote(sample('Phone first', { content: `${MARK} from the phone` }));
  await database.openProfileDatabase(desk.id); // the profile open in the window: the hub shares its connection
  const first = await notes.saveNote(sample('Desk first', { content: `${MARK} from the desk` }));
  const doomed = await notes.saveNote(sample('Doomed', { content: `${MARK} will be erased` }));

  const hub = new SyncHub({ spawn, isReady: () => true, ifaces: () => ({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }) });
  hub.settings.port = await freePort();
  hub.settings.tunnelName = 'test.local';
  await hub.setOn(true);
  await until(() => hub.controller.status.state === 'running');
  await hub.setProfileSync(desk.id, true);
  const syncId = hub.settings.syncIds[desk.id];
  assert.match(syncId, /^[0-9a-f-]{36}$/);

  // Files: settings with no secrets, the key in the keyring store only, owner-only modes.
  const settingsText = readFileSync(join(dir, 'hub.json'), 'utf8');
  const secure = JSON.parse(readFileSync(join(dir, 'secure.json'), 'utf8'));
  assert.match(secure.hubKey, /^[0-9a-f]{64}$/);
  assert.ok(!settingsText.includes(secure.hubKey));
  if (process.platform !== 'win32') { assert.equal(mode(join(dir, 'hub.json')), 0o600); assert.equal(mode(join(dir, 'secure.json')), 0o600); }

  const pair = (await hub.call('pairStart', undefined)) as { uri: string; hubId: string; expiresAt: number };
  assert.equal(pair.hubId, await hub.hubId());
  const link = parsePairing(pair.uri);
  const wire = await relay(link.port);

  const phoneDb = await database.openProfileConnection(phone.id);
  await database.initDatabase(phoneDb);
  const phoneStore = storageStore(phoneDb, 'Phone', phone.id);
  const deviceKey = generateKeypair();
  let token: Uint8Array | undefined = link.token;
  const client = new Client({
    store: phoneStore, clock: { now: () => Date.now(), after: (ms, fn) => { const t = setTimeout(fn, Math.min(ms, 300)); return () => clearTimeout(t); } },
    rng: Math.random, hash: sha256, link: { syncId, name: 'Pixel' },
    connect: wsConnector({ deviceKey, hubKey: link.hubKey, name: 'Pixel', addresses: [{ host: '127.0.0.1', port: wire.port }], token: () => { const t = token; token = undefined; return t; } }),
  });
  client.start();
  await until(() => client.state === 'live');
  await until(async () => (await titles(database.db)).length === 3 && (await titles(phoneDb)).length === 3);
  assert.deepEqual(await titles(database.db), await titles(phoneDb));
  assert.equal((await hub.status()).paired, 'Pixel', 'paired event');

  // Both ways, through the window's own connection on the desk side.
  await notes.updateNote({ id: first, title: 'Desk first', content: `${MARK} edited at the desk`, isMarkdown: true });
  await until(async () => (await titles(phoneDb)).includes(`Desk first|${MARK} edited at the desk`));
  const phoneUuid = (await phoneDb.getFirstAsync("SELECT uuid FROM notes WHERE title = 'Phone first'")).uuid;
  await phoneStore.applyFile(syncId, phoneUuid, { base: null, title: 'Phone first', content: `${MARK} edited on the phone`, isPinned: false, isArchived: false });
  await until(async () => (await titles(database.db)).includes(`Phone first|${MARK} edited on the phone`));

  // An erase at the desk reaches the phone.
  await notes.deleteNote(doomed);
  await until(async () => !(await titles(phoneDb)).some(t => t.startsWith('Doomed')));

  // Unprotected profiles of one install share note-files/<hash> (F23), so this only shows the reference arrives and the file is readable from the desk;
  // the blob frames themselves are proven in engine-storage.test.ts.
  const bytes = Uint8Array.from({ length: 150_000 }, (_, i) => (i * 7 + 3) & 255);
  const added = await attachments.addAttachment({ bytes, name: 'plan.pdf', size: bytes.length }, phone.id);
  await phoneStore.applyFile(syncId, null, { base: null, title: 'With file', content: `[plan.pdf](attachment:${added.hash})`, isPinned: false, isArchived: false });
  await until(() => attachments.hasAttachment(added.hash, desk.id));
  assert.deepEqual(await attachments.readAttachment(added.hash, desk.id), bytes);

  // The hub process dies; it restarts, the phone reconnects, an edit still arrives.
  const before = hub.controller.restarts;
  signal(children.at(-1)!);
  await until(() => hub.controller.restarts > before && hub.controller.status.state === 'running');
  await notes.updateNote({ id: first, title: 'Desk first', content: `${MARK} after the restart`, isMarkdown: true });
  await until(async () => (await titles(phoneDb)).includes(`Desk first|${MARK} after the restart`));

  // Revoke while connected: the connection ends and the device is not let back in.
  const [dev] = (await hub.call('devices', undefined)) as { key: string; name: string }[];
  assert.equal(dev.name, 'Pixel');
  await hub.call('revoke', { key: dev.key });
  await until(() => client.state !== 'live');
  await new Promise(r => setTimeout(r, 1500));
  assert.notEqual(client.state, 'live');
  assert.deepEqual(await hub.call('devices', undefined), []);
  assert.equal(mode(join(dir, 'devices.json')), 0o600);

  // No note text, title or file bytes on the wire.
  const all = wire.bytes();
  assert.ok(all.length > 4000, `wire bytes ${all.length}`);
  for (const needle of [MARK, 'Desk first', 'Phone first', 'Doomed', 'plan.pdf', Buffer.from(bytes.slice(1000, 1032)).toString('latin1')]) assert.ok(!all.includes(Buffer.from(needle, 'latin1')), `found "${needle}" on the wire`);

  client.stop();
  wire.close();
  await hub.stop();
});

test('a protected profile that is locked is never opened and its key never reaches the hub process', async () => {
  const work = await profiles.addProfile('Work', '1234');
  const key = await database.getProfileKey(work.id);
  assert.match(key, /^[0-9a-f]{64}$/);
  const seen: string[] = [];
  const spy = () => {
    const c = spawn();
    const log = (m: unknown) => seen.push(JSON.stringify(m, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v instanceof Map ? [...v] : v)));
    return { ...c, port: { send: (m: unknown) => { log(m); c.port.send(m); }, on: (cb: (m: unknown) => void) => c.port.on(m => { log(m); cb(m); }) } };
  };
  let ready = true;
  const hub = new SyncHub({ spawn: spy, isReady: () => ready, ifaces: () => ({}) });
  hub.settings.port = await freePort();
  await database.openProfileDatabase(work.id);
  await hub.setOn(true);
  await until(() => hub.controller.status.state === 'running');
  await hub.setProfileSync(work.id, true);
  ready = false; // locked in the window
  await hub.profilesChanged();
  const [entry] = (await hub.status()).profiles.filter((p: any) => p.id === work.id);
  assert.equal(entry.locked, true);
  await assert.rejects(hub.setProfileSync('other', true));
  const store = (hub as any).multi.store;
  const syncId = hub.settings.syncIds[work.id];
  await assert.rejects(store.docs(syncId), (e: any) => e.code === 'LOCKED');
  assert.ok(seen.length > 0);
  assert.ok(seen.every(m => !m.includes(key)), 'the profile key crossed the port');
  await hub.stop();
});

test('hub.json: a damaged file means sync off, odd values are dropped, nothing is read as "more open"', async () => {
  const { readSettings } = await import('../../../desktop/src/main/syncHub.ts');
  const { writeFileSync } = await import('node:fs');
  const p = join(dir, 'probe-hub.json');
  writeFileSync(p, '{ nope');
  assert.equal(readSettings(p).on, false);
  writeFileSync(p, JSON.stringify({ format: 1, on: 'yes', port: 80, acceptNew: 1, profiles: ['a', 7, { x: 1 }], syncIds: { a: 'bad', b: '00000000-0000-4000-8000-000000000000' }, mirrorFolder: 5 }));
  const s = readSettings(p);
  assert.deepEqual([s.on, s.port, s.acceptNew, s.profiles, Object.keys(s.syncIds), s.mirrorFolder], [false, 4578, false, ['a'], ['b'], null]);
  assert.ok(crdt);
});

test.after(() => { for (const c of children) c.kill('SIGKILL'); });
