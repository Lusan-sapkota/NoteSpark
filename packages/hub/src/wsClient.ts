// The Node end of the transport: a Noise-secured WebSocket as a Channel (docs/architecture/sync-architecture.md section 4).
import { isPrivateAddress } from '@notespark/core';
import { type Channel, type Clock, type Keypair, type RawSocket, SecureChannel, realClock } from '@notespark/sync-protocol';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { WebSocket } from 'ws';

export const SUBPROTOCOL = 'notespark.sync.v1';
export const MAX_WS_MESSAGE = 65_535;
export const PING_EVERY = 15_000;
export const DEAD_AFTER = 45_000;
const CLOSE_GRACE = 3000;

const toBytes = (d: unknown): Uint8Array | null => {
  if (d instanceof Uint8Array) return new Uint8Array(d); // copy: ws reuses its buffers
  if (Array.isArray(d)) return Buffer.concat(d as Buffer[]);
  return null;
};

// A `ws` socket as a RawSocket: binary only, no compression, ping every 15 s, dead after 45 s of silence.
export const rawFromWs = (ws: WebSocket, clock: Clock = realClock): RawSocket => {
  const queued: Uint8Array[] = [];
  let last = clock.now();
  let stop = () => {};
  const raw: RawSocket = {
    send: d => { if (ws.readyState === WebSocket.CONNECTING) queued.push(d); else if (ws.readyState === WebSocket.OPEN) ws.send(d, { binary: true }); },
    close: graceful => {
      if (graceful && ws.readyState === WebSocket.OPEN) { ws.close(1000); const cancel = clock.after(CLOSE_GRACE, () => ws.terminate()); ws.once('close', cancel); } else ws.terminate();
    },
    onMessage: () => {},
    onClose: () => {},
  };
  const tick = () => {
    if (clock.now() - last >= DEAD_AFTER) return ws.terminate();
    if (ws.readyState === WebSocket.OPEN) ws.ping();
    stop = clock.after(PING_EVERY, tick);
  };
  stop = clock.after(PING_EVERY, tick);
  ws.on('pong', () => { last = clock.now(); });
  ws.on('open', () => { for (const d of queued.splice(0)) ws.send(d, { binary: true }); });
  ws.on('message', (data, isBinary) => {
    last = clock.now();
    const b = isBinary ? toBytes(data) : null;
    if (b) raw.onMessage(b); else ws.terminate(); // text frames are never valid
  });
  ws.on('close', () => { stop(); raw.onClose(); });
  ws.on('error', () => {}); // the close event follows
  return raw;
};

export interface Target { host: string; port: number }

export interface ConnectorOptions {
  deviceKey: Keypair;
  hubKey: Uint8Array;
  name: string;
  addresses: Target[]; // tried one per attempt, in turn; each must be a private address or a .local / .ts.net name
  token?: () => Uint8Array | undefined; // pairing only
  clock?: Clock;
  resolve?: (host: string) => Promise<string[]>; // a test seam; the default is the operating system
  onChannel?: (c: SecureChannel, target: Target) => void;
}

const osResolve = async (host: string) => (await lookup(host, { all: true })).map(a => a.address);

// A name is resolved first and every answer must be private, then the IP is dialled (never the name), so a name that
// points at the internet is refused like any public address. Until the socket exists, sends are held.
const deferred = (target: Promise<WebSocket | null>, clock?: Clock): RawSocket => {
  const held: Uint8Array[] = [];
  let inner: RawSocket | null = null, closed = false;
  const raw: RawSocket = {
    send: d => { if (inner) inner.send(d); else if (!closed) held.push(d); },
    close: g => { closed = true; held.length = 0; inner ? inner.close(g) : raw.onClose(); },
    onMessage: () => {},
    onClose: () => {},
  };
  target.then(ws => {
    if (!ws || closed) { ws?.terminate(); if (!closed) { closed = true; raw.onClose(); } return; }
    inner = rawFromWs(ws, clock);
    inner.onMessage = d => raw.onMessage(d);
    inner.onClose = () => { closed = true; raw.onClose(); };
    for (const d of held.splice(0)) inner.send(d);
  }, () => { if (!closed) { closed = true; raw.onClose(); } });
  return raw;
};

// For `Client`'s `connect`: a new secure channel each call. A public address is refused (null), never dialled.
export const wsConnector = (o: ConnectorOptions): (() => Channel | null) => {
  let turn = 0;
  const open = (host: string, port: number) => {
    const bare = host.replace(/^\[|\]$/g, '');
    const url = `ws://${bare.includes(':') ? `[${bare.replace('%', '%25')}]` : bare}:${port}`;
    return new WebSocket(url, SUBPROTOCOL, { maxPayload: MAX_WS_MESSAGE, perMessageDeflate: false, handshakeTimeout: 10_000 });
  };
  return () => {
    const target = o.addresses[turn++ % o.addresses.length];
    if (!target || !isPrivateAddress(target.host)) return null;
    const literal = isIP(target.host.replace(/^\[|\]$/g, '').replace(/%.*$/, '')) !== 0;
    let raw: RawSocket;
    try {
      raw = literal
        ? rawFromWs(open(target.host, target.port), o.clock)
        : deferred((async () => {
          const ips = await (o.resolve ?? osResolve)(target.host);
          if (ips.length === 0 || !ips.every(isPrivateAddress)) return null; // resolves to the internet: never dialled
          return open(ips[0], target.port);
        })(), o.clock);
    } catch { return null; } // a host string the URL parser refuses
    const channel = SecureChannel.client(raw, { s: o.deviceKey, hubKey: o.hubKey, name: o.name, token: o.token?.() });
    o.onChannel?.(channel, target);
    return channel;
  };
};
