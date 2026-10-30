// The phone's end of the transport: a React Native WebSocket as a RawSocket, and the connector Client uses
// (docs/architecture/sync-architecture.md section 4). It mirrors packages/hub/src/wsClient.ts; the differences are
// the React Native WebSocket's: no ping (the session's own PING frames find a dead peer), no way to drop the Origin
// header (so a fixed one is sent), no DNS hook (IP literals only), no size cap before a message arrives.
import './random';
import { isPrivateAddress } from '@notespark/core';
import { APP_ORIGIN, type Channel, type Clock, type Keypair, type RawSocket, SecureChannel, realClock } from '@notespark/sync-protocol';

export const SUBPROTOCOL = 'notespark.sync.v1';
export const MAX_MESSAGE = 65_535;
const OPEN_TIMEOUT = 10_000;

// The part of WebSocket used here, so tests can pass the `ws` package.
export interface WS {
  binaryType: string;
  readyState: number;
  send(data: Uint8Array): void;
  close(code?: number): void;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
}
export type WSConstructor = new (url: string, protocols: string, options: { headers: Record<string, string> }) => WS;

const CONNECTING = 0, OPEN = 1;

export const rawFromRN = (ws: WS, clock: Clock = realClock): RawSocket => {
  const queued: Uint8Array[] = [];
  let done = false;
  let cancel = () => {};
  const finish = () => {
    if (done) return;
    done = true;
    cancel();
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    raw.onClose();
  };
  const kill = () => { try { ws.close(1000); } catch { /* already closed */ } finish(); };
  const raw: RawSocket = {
    send: d => { if (done) return; if (ws.readyState === CONNECTING) queued.push(d); else if (ws.readyState === OPEN) ws.send(d); },
    close: () => { queued.length = 0; kill(); }, // no terminate() in React Native, so even a graceful close ends the session at once
    onMessage: () => {},
    onClose: () => {},
  };
  ws.binaryType = 'arraybuffer';
  cancel = clock.after(OPEN_TIMEOUT, kill); // the handshake window; cleared on open
  ws.onopen = () => { cancel(); for (const d of queued.splice(0)) ws.send(d); };
  ws.onmessage = e => {
    const d = e.data;
    if (!(d instanceof ArrayBuffer) || d.byteLength > MAX_MESSAGE) return kill(); // text frames and oversized messages are never valid
    raw.onMessage(new Uint8Array(d));
  };
  ws.onclose = finish;
  ws.onerror = () => {}; // onclose follows
  return raw;
};

export interface Target { host: string; port: number }

export interface ConnectorOptions {
  WebSocket: WSConstructor;
  deviceKey: Keypair;
  hubKey: Uint8Array;
  name: string;
  addresses: Target[]; // tried one per attempt, in turn
  token?: () => Uint8Array | undefined; // pairing only
  clock?: Clock;
  onChannel?: (c: SecureChannel, target: Target) => void;
}

const isIPLiteral = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.includes(':') && /^[0-9a-fA-F:.%\w-]+$/.test(h));

// For `Client`'s `connect`: a new secure channel each call. A public address, or a name (no DNS hook, F38), is never dialled: null.
export const rnConnector = (o: ConnectorOptions): (() => Channel | null) => {
  let turn = 0;
  return () => {
    const target = o.addresses[turn++ % o.addresses.length];
    if (!target) return null;
    const bare = target.host.replace(/^\[|\]$/g, '');
    if (!isIPLiteral(bare) || !isPrivateAddress(bare)) return null;
    let raw: RawSocket;
    try {
      const url = `ws://${bare.includes(':') ? `[${bare.replace('%', '%25')}]` : bare}:${target.port}`;
      raw = rawFromRN(new o.WebSocket(url, SUBPROTOCOL, { headers: { Origin: APP_ORIGIN } }), o.clock);
    } catch { return null; }
    const channel = SecureChannel.client(raw, { s: o.deviceKey, hubKey: o.hubKey, name: o.name, token: o.token?.() });
    o.onChannel?.(channel, target);
    return channel;
  };
};
