import { createHash } from 'node:crypto';
import net from 'node:net';
import { MemoryStore } from '@notespark/sync';
import { Client, Hub, generateKeypair, realClock } from '@notespark/sync-protocol';
import { WebSocket } from 'ws';
import { HubServer, type ServerOptions } from '../src/wsServer.ts';
import { SUBPROTOCOL, wsConnector } from '../src/wsClient.ts';

export const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
export const T0 = '2026-01-01T00:00:00.000Z';
export const note = (title: string, content = `${title} body`) => ({ title, content, isMarkdown: true, isPinned: false, isArchived: false, deletedAt: null, createdAt: T0, updatedAt: T0 });
export const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const until = async (fn: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); }
};
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const setup = async (over: Partial<ServerOptions> = {}) => {
  const hubKey = generateKeypair();
  const known = new Set<string>();
  const log: string[] = [];
  const store = new MemoryStore(1);
  const hub = new Hub(store, realClock, sha256);
  const server = new HubServer({
    host: '127.0.0.1', port: 0, hubKey, name: 'Test hub', hub, authorize: k => known.has(Buffer.from(k).toString('hex')), log: e => log.push(e), ...over,
  });
  await server.listen();
  const port = (server.address() as net.AddressInfo).port;
  const device = (name = 'Phone', syncId?: string, link?: { syncId: string; name: string }) => {
    const key = generateKeypair();
    known.add(Buffer.from(key.pub).toString('hex'));
    const dstore = new MemoryStore(100 + known.size);
    const client = new Client({
      store: dstore, clock: realClock, rng: Math.random, hash: sha256, syncId, link,
      connect: wsConnector({ deviceKey: key, hubKey: hubKey.pub, name, addresses: [{ host: '127.0.0.1', port }] }),
    });
    return { key, store: dstore, client };
  };
  return { hubKey, known, log, store, hub, server, port, device, stop: async () => { hub.stop(); await server.close(); } };
};

// Raw WebSocket helpers
export const open = (port: number, opts: { protocols?: string | string[]; headers?: Record<string, string> } = {}) =>
  new WebSocket(`ws://127.0.0.1:${port}`, opts.protocols ?? SUBPROTOCOL, { headers: opts.headers, perMessageDeflate: false });
export const outcome = (ws: WebSocket) => new Promise<{ opened: boolean; messages: number; status?: number }>(resolve => {
  let opened = false, messages = 0, status: number | undefined;
  ws.on('open', () => { opened = true; });
  ws.on('message', () => { messages++; });
  ws.on('unexpected-response', (_r, res) => { status = res.statusCode; });
  ws.on('error', () => {});
  ws.on('close', () => resolve({ opened, messages, status }));
});
export const rawTcp = (port: number, bytes: Uint8Array | null) => new Promise<{ received: number; closedAfterMs: number }>(resolve => {
  const t0 = Date.now();
  let received = 0;
  const s = net.connect(port, '127.0.0.1', () => { if (bytes) s.write(bytes); });
  s.on('data', d => { received += d.length; });
  s.on('error', () => {});
  s.on('close', () => resolve({ received, closedAfterMs: Date.now() - t0 }));
});

