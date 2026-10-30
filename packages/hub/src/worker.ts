// The hub process: the transport, never storage. It reaches the databases only through `remoteStore` over the port.
// Control messages (k: 'c:*') come from the main process; store messages (k: 's:*') go the other way (storeRpc.ts).
import { createHash } from 'node:crypto';
import { realClock, keypairFromPrivate } from '@notespark/sync-protocol';
import { DeviceListError } from './devices.ts';
import { HubHost } from './host.ts';
import type { Port } from './port.ts';
import { remoteStore } from './storeRpc.ts';

export interface WorkerConfig {
  dir: string;
  name: string;
  keyHex: string; // the hub's private key: handed over at start, held in memory only
  port: number;
  hosts: string[];
  tunnelName?: string;
}

const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));

export const runWorker = (port: Port) => {
  const { store, closed } = remoteStore(port);
  let host: HubHost | null = null;
  const event = (ev: unknown) => port.send({ k: 'c:ev', ev });

  const ops: Record<string, (a: any) => unknown | Promise<unknown>> = {
    start: async (c: WorkerConfig) => {
      if (host) return { port: host.port, hosts: host.hosts };
      if (!/^[0-9a-f]{64}$/.test(c.keyHex)) throw Object.assign(new Error('Bad key'), { code: 'BAD_KEY' });
      try {
        host = new HubHost({ store, dir: c.dir, name: c.name, hubKey: keypairFromPrivate(fromHex(c.keyHex)), port: c.port, hosts: c.hosts, tunnelName: c.tunnelName, clock: realClock, hash: sha256, onEvent: event });
      } catch (e) {
        if (e instanceof DeviceListError) throw Object.assign(e, { code: 'DEVICE_LIST' });
        throw e;
      }
      await host.start();
      return { port: host.port, hosts: host.hosts, skipped: host.skipped };
    },
    setHosts: async (hosts: string[]) => { await host!.setHosts(hosts); return { port: host!.port, hosts: host!.hosts }; },
    pairStart: () => host!.pairStart(),
    pairCancel: () => host!.pairCancel(),
    pairState: () => host!.pairState(),
    devices: () => host!.deviceList(),
    rename: (a: { key: string; name: string }) => host!.rename(a.key, a.name),
    revoke: (a: { key: string }) => host!.revoke(a.key),
    setMirror: (a: { folder: string | null; profiles: { syncId: string; name: string; isProtected: boolean }[] }) => host!.setMirror(a.folder, a.profiles),
    mirrorStatus: () => host!.mirrorStatus(),
    diagnostics: () => host!.diagnostics(),
    stop: async () => { await host?.stop(); host = null; },
  };

  port.on(raw => {
    const m = raw as { k?: string; id?: number; op?: string; args?: unknown };
    if (!m || typeof m !== 'object') return;
    if (m.k === 'c:ping') return port.send({ k: 'c:pong' });
    if (m.k !== 'c:call' || typeof m.id !== 'number' || typeof m.op !== 'string' || !Object.hasOwn(ops, m.op)) return;
    if (m.op !== 'start' && !host) return port.send({ k: 'c:ret', id: m.id, ok: false, message: 'Sync is not running', code: 'NOT_RUNNING' });
    Promise.resolve().then(() => ops[m.op!](m.args)).then(
      value => port.send({ k: 'c:ret', id: m.id, ok: true, value: value ?? null }),
      (e: any) => port.send({ k: 'c:ret', id: m.id, ok: false, message: e?.message ?? String(e), code: e?.code })
    );
  });
  return { dispose: () => { closed(); void host?.stop(); } };
};
