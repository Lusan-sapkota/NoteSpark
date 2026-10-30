// The hub as a real child process: pairing, a full sync through it, the child killed at random points, a silent child, a bad device list.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MemoryStore } from '@notespark/sync';
import { Client, type Clock, generateKeypair, parsePairing, realClock } from '@notespark/sync-protocol';
import { HubController, type Spawned } from '../src/controller.ts';
import { fromProcess } from '../src/port.ts';
import { wsConnector } from '../src/wsClient.ts';
import { U, note, sha256, sleep, until } from './support.ts';

const register = new URL('../../node-shims/test/loader/register.mjs', import.meta.url).href;
const entry = new URL('./worker-entry.ts', import.meta.url).pathname;
const children: import('node:child_process').ChildProcess[] = [];
// Only ever signals a pid this file forked (never 0 or 1, which would reach a whole process group).
const signal = (pid: number | undefined, sig: NodeJS.Signals) => { if (!pid || pid <= 1 || !children.some(c => c.pid === pid)) throw new Error('refusing to signal pid ' + pid); process.kill(pid, sig); };
const spawn = (): Spawned & { pid: number } => {
  const c = fork(entry, [], { serialization: 'advanced', execArgv: ['--import', register], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  children.push(c);
  c.on('error', () => {});
  return { port: fromProcess(c), kill: () => void c.kill('SIGKILL'), onExit: cb => void c.on('exit', cb), pid: c.pid! };
};
const freePort = () => new Promise<number>(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const fast: Clock = { now: () => Date.now() * 10, after: (ms, fn) => { const t = setTimeout(fn, ms / 10); return () => clearTimeout(t); } };
const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const same = (a: MemoryStore, b: MemoryStore) => JSON.stringify(Object.entries(a.notes('s1')).sort()) === JSON.stringify(Object.entries(b.notes('s1')).sort());

const make = async (store: MemoryStore, dir = mkdtempSync(join(tmpdir(), 'ns-hub-')), over = {}) => {
  const port = await freePort();
  const key = generateKeypair();
  const controller = new HubController({
    spawn, store, clock: realClock, minMs: 100, maxMs: 400,
    config: () => ({ dir, name: 'Test computer', keyHex: hex(key.priv), port, hosts: ['127.0.0.1'], tunnelName: 'test.local' }), ...over,
  });
  controllers.push(controller);
  controller.start();
  await until(() => controller.status.state === 'running');
  return { controller, key, port, dir };
};
const phone = async (h: { controller: HubController; key: ReturnType<typeof generateKeypair>; port: number }, name = 'Phone') => {
  const p = (await h.controller.call('pairStart')) as { uri: string };
  const link = parsePairing(p.uri);
  const deviceKey = generateKeypair();
  const store = new MemoryStore(500);
  let used = false;
  const client = new Client({
    store, clock: fast, rng: seeded(7), hash: sha256, link: { syncId: 's1', name },
    connect: wsConnector({ deviceKey, hubKey: link.hubKey, name, addresses: [{ host: '127.0.0.1', port: link.port }], token: () => (used ? undefined : ((used = true), link.token)), clock: fast }),
  });
  return { store, client, deviceKey };
};

const controllers: HubController[] = [];
test.after(() => { for (const c of controllers) c.stop(); for (const c of children) c.kill('SIGKILL'); });

test('pair and sync through the hub process, in both directions, and the link carries no loopback address', async () => {
  const main = new MemoryStore(1);
  await main.createProfile('s1', 'Personal');
  main.edit('s1', U(1), note('on the computer'));
  const h = await make(main);
  const p = (await h.controller.call('pairStart')) as { uri: string; code: string; hubId: string; expiresAt: number; addresses: string[] };
  assert.deepEqual(p.addresses, ['test.local']); // loopback is bound here but never goes in the link: a phone cannot use it
  assert.match(p.hubId, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  const d = await phone(h);
  d.store.plain.set(U(2), note('on the phone'));
  d.client.start();
  await until(() => d.client.state === 'live');
  await until(() => same(main, d.store) && Object.keys(main.notes('s1')).length === 2);
  main.edit('s1', U(1), note('on the computer', 'changed here'));
  await until(() => d.store.peek('s1', U(1))?.content === 'changed here');
  d.store.edit('s1', U(2), note('on the phone', 'changed there'));
  await until(() => main.peek('s1', U(2))?.content === 'changed there');
  const list = (await h.controller.call('devices')) as { name: string }[];
  assert.deepEqual(list.map(x => x.name), ['Phone']);
  d.client.stop();
  h.controller.stop();
});

test('the hub process is killed at random moments during a large sync: it restarts, the client reconnects, both sides end identical', async () => {
  for (const seed of [11, 12, 13, 14]) {
    const rng = seeded(seed);
    const main = new MemoryStore(1);
    await main.createProfile('s1', 'Personal');
    for (let i = 1; i <= 150; i++) main.edit('s1', U(i), note(`n${i}`, 'x'.repeat(4000) + i));
    const h = await make(main);
    const d = await phone(h);
    // the token is single use; after the first pairing the device is known
    d.client.start();
    for (let kill = 0; kill < 3; kill++) {
      await sleep(10 + Math.floor(rng() * 90));
      signal(children.at(-1)!.pid, 'SIGKILL');
      await until(() => h.controller.status.state === 'running' && h.controller.restarts > kill, 10_000);
    }
    await until(() => same(main, d.store) && Object.keys(d.store.notes('s1')).length === 150, 20_000);
    main.edit('s1', U(1), note('n1', 'after the restarts'));
    await until(() => d.store.peek('s1', U(1))?.content === 'after the restarts');
    assert.ok(h.controller.restarts >= 3, `seed ${seed}`);
    d.client.stop();
    h.controller.stop();
  }
});

test('a silent hub process (stopped, not dead) is killed by the watchdog and replaced', async () => {
  const main = new MemoryStore(1);
  await main.createProfile('s1', 'Personal');
  const h = await make(main, undefined, { pingMs: 200, deadMs: 3000 });
  const pid = children.at(-1)!.pid!;
  signal(pid, 'SIGSTOP');
  await until(() => h.controller.restarts >= 1 && h.controller.status.state === 'running', 10_000);
  assert.notEqual(children.at(-1)!.pid, pid);
  h.controller.stop();
});

test('a device list that cannot be trusted stops the hub: nothing listens, no restart loop, the message says what to do', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ns-hub-'));
  writeFileSync(join(dir, 'devices.json'), '{ this is not json', { mode: 0o600 });
  const port = await freePort();
  const main = new MemoryStore(1);
  const controller = new HubController({
    spawn, store: main, clock: realClock, minMs: 50,
    config: () => ({ dir, name: 'x', keyHex: hex(generateKeypair().priv), port, hosts: ['127.0.0.1'] }),
  });
  controllers.push(controller);
  controller.start();
  await until(() => controller.status.state === 'problem');
  assert.match(controller.status.message!, /cannot be trusted/);
  await sleep(400);
  assert.equal(controller.restarts, 0);
  assert.equal(controller.status.state, 'problem');
  await assert.rejects(new Promise((res, rej) => { const s = net.connect(port, '127.0.0.1', () => res(s)); s.on('error', rej); }));
});
