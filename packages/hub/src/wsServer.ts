// The hub's door (docs/architecture/sync-architecture.md section 9). Gates run in this order, cheapest first, and nothing
// is parsed as a note until the Noise handshake has succeeded: private address, caps and rate, a 5 s clock for the first
// message, no Origin header, the subprotocol, at most 1 KB, then Noise. Failures close the socket with no reply.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { isPrivateAddress } from '@notespark/core';
import { type Clock, type Hub, type HelloPayload, type Keypair, MAX_FIRST_MESSAGE, SecureChannel, realClock } from '@notespark/sync-protocol';
import { WebSocketServer } from 'ws';
import { MAX_WS_MESSAGE, SUBPROTOCOL, rawFromWs } from './wsClient.ts';

export interface Limits {
  firstMessageMs: number; // from TCP accept to the first Noise message
  maxConnections: number;
  maxPerIp: number;
  newPerIp: number; // connection attempts per window
  windowMs: number;
}
export const LIMITS: Limits = { firstMessageMs: 5000, maxConnections: 64, maxPerIp: 8, newPerIp: 30, windowMs: 10_000 };

export interface ServerOptions {
  host: string; // never defaulted: the caller says what to bind to
  port: number;
  hubKey: Keypair;
  name: string;
  hub: Hub;
  authorize: (clientKey: Uint8Array, hello: HelloPayload) => boolean; // false: unknown device, closed with no reply
  stillKnown?: (clientKey: Uint8Array) => boolean; // asked again when the device confirms, so a revoke in between wins
  clock?: Clock;
  limits?: Partial<Limits>;
  peerAddress?: (socket: Socket) => string; // a test seam
  log?: (event: string) => void;
}

// What the caps count: an IPv4 address, or the /64 an IPv6 address belongs to (one machine can hold a whole /64).
export const limitKey = (address: string): string => {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!ip.includes(':') || /^(?:::ffff:)?\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/^::ffff:/, '');
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...new Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.slice(0, 4).map(g => (g || '0').padStart(4, '0')).join(':') + '::/64';
};

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

export class HubServer {
  private o: ServerOptions;
  private limits: Limits;
  private clock: Clock;
  private http: Server;
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE, perMessageDeflate: false, handleProtocols: () => SUBPROTOCOL });
  private sockets = new Set<Socket>();
  private perIp = new Map<string, number>();
  private attempts = new Map<string, number[]>();
  private byDevice = new Map<string, Set<SecureChannel>>();

  constructor(o: ServerOptions) {
    this.o = o;
    this.limits = { ...LIMITS, ...o.limits };
    this.clock = o.clock ?? realClock;
    this.http = createServer((_req, res) => res.destroy()); // plain HTTP gets nothing
    this.http.on('connection', s => this.onConnection(s));
    this.http.on('clientError', (_e, s) => s.destroy()); // TLS, garbage, slow headers
    this.http.on('upgrade', (req, s, head) => this.onUpgrade(req, s as Socket, head));
    this.http.headersTimeout = this.limits.firstMessageMs;
  }

  get connections() { return this.sockets.size; }
  address() { return this.http.address(); }

  listen() {
    return new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.o.port, this.o.host, () => resolve());
    });
  }
  async close() {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>(r => this.http.close(() => r()));
  }

  // Revocation: every open connection of this device ends now.
  closeDevice(key: Uint8Array) {
    for (const c of [...(this.byDevice.get(hex(key)) ?? [])]) c.close();
  }

  private onConnection(socket: Socket) {
    const address = (this.o.peerAddress ?? (s => s.remoteAddress ?? ''))(socket);
    const ip = limitKey(address);
    const L = this.limits, now = this.clock.now();
    const recent = (this.attempts.get(ip) ?? []).filter(t => now - t < L.windowMs);
    recent.push(now);
    this.attempts.set(ip, recent);
    if (this.attempts.size > 1024) for (const [k, v] of this.attempts) if (v.every(t => now - t >= L.windowMs)) this.attempts.delete(k);
    const mine = this.perIp.get(ip) ?? 0;
    if (!isPrivateAddress(address)) return this.refuse(socket, 'public address');
    if (this.sockets.size >= L.maxConnections || mine >= L.maxPerIp) return this.refuse(socket, 'connection cap');
    if (recent.length > L.newPerIp) return this.refuse(socket, 'rate limit');
    this.sockets.add(socket);
    this.perIp.set(ip, mine + 1);
    const timer = this.clock.after(L.firstMessageMs, () => { this.o.log?.('no handshake in time'); socket.destroy(); });
    (socket as Socket & { stopTimer?: () => void }).stopTimer = timer;
    socket.once('close', () => {
      timer();
      this.sockets.delete(socket);
      const n = (this.perIp.get(ip) ?? 1) - 1;
      if (n > 0) this.perIp.set(ip, n); else this.perIp.delete(ip);
    });
    socket.on('error', () => {});
  }
  private refuse(socket: Socket, why: string) {
    this.o.log?.(`refused: ${why}`);
    socket.on('error', () => {});
    socket.destroy();
  }

  private onUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(p => p.trim());
    if (req.headers.origin !== undefined) { this.o.log?.('refused: Origin header'); return socket.destroy(); } // a web page
    if (req.method !== 'GET' || !protocols.includes(SUBPROTOCOL) || head.length > MAX_FIRST_MESSAGE) { this.o.log?.('refused: not our protocol'); return socket.destroy(); }
    this.wss.handleUpgrade(req, socket, head, ws => {
      const stop = (socket as Socket & { stopTimer?: () => void }).stopTimer;
      const raw = rawFromWs(ws, this.clock);
      SecureChannel.hub(raw, {
        s: this.o.hubKey,
        name: this.o.name,
        authorize: (key, hello) => {
          const ok = this.o.authorize(key, hello);
          if (!ok) this.o.log?.('unknown device');
          return ok;
        },
        onReady: channel => {
          stop?.();
          if (this.o.stillKnown && !this.o.stillKnown(channel.peer!.staticKey)) return channel.close();
          const id = hex(channel.peer!.staticKey);
          if (!this.byDevice.has(id)) this.byDevice.set(id, new Set());
          this.byDevice.get(id)!.add(channel);
          this.o.hub.accept(channel, {
            onClosed: () => {
              const set = this.byDevice.get(id);
              set?.delete(channel);
              if (set && !set.size) this.byDevice.delete(id);
            },
          });
        },
      });
    });
  }
}
