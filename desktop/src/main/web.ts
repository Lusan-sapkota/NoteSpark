import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { isPrivateAddress, t } from '@notespark/core';
import { type IfaceMap, limitKey, listenAddresses } from '@notespark/hub';
import { dataDir } from '@notespark/node-shims/paths';

// The web view: the desktop UI bundle plus the same backend API, for a browser on your own network.
// Off until switched on. Private by default (decision D5): only this computer and tunnel addresses (Tailscale 100.64/10, WireGuard);
// the Wi-Fi switch ("Not encrypted on this network", in Settings > Sync, hub.json `webLan`) adds the other private addresses.
// A random token, and nothing is stored on disk.
type Invoke = (channel: string, args: unknown, from: 'ipc' | 'http') => Promise<unknown>;

let PORT = 4577;
// Test seams; the app uses the defaults.
export interface WebOptions { port?: number; headerMs?: number; lan?: () => boolean; ifaces?: () => IfaceMap; serve?: (pathname: string) => Promise<{ type: string; body: Buffer; headers?: Record<string, string> } | null> }
let options: WebOptions = {};
export const configureWebView = (o: WebOptions) => { options = o; };
const readLan = () => { try { return JSON.parse(readFileSync(join(dataDir(), 'hub.json'), 'utf8')).webLan === true; } catch { return false; } };
const serve = async (pathname: string) => (options.serve ?? (await import('./assets')).serveAsset)(pathname);
let lanNow = false; // whether the Wi-Fi switch was on when the view started
const MAX_CONNECTIONS = 64;
const HEADER_MS = 5000; // a client has this long to send its request line and headers
const MAX_BODY = 25_000_000; // room for one picture as base64 (15 MB limit in assets.ts); only read after sign-in
let servers: Server[] = [];
let token = '';
let hosts: string[] = []; // host:port values we answer to (Host header check against DNS rebinding)
const sessions = new Set<string>();
const failures = new Map<string, { count: number; resetAt: number }>();

const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const random = () => randomBytes(32).toString('hex');

// This computer, plus tunnel addresses, plus the other private addresses only with the Wi-Fi switch.
const bindAddresses = () => listenAddresses((options.ifaces ?? networkInterfaces)() as IfaceMap, { lan: lanNow });

// Who may talk to the view at all: this computer and tunnel peers always, other private peers only with the Wi-Fi switch.
const peerAllowed = (address: string) => {
  const ip = address.replace(/^::ffff:/i, '');
  if (!isPrivateAddress(ip)) return false;
  return lanNow || ip === '::1' || /^127\./.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
};

// Counted per IPv4 address or IPv6 /64, like the hub's caps.
export const peerAllowedForTest = (address: string, lan: boolean) => { const was = lanNow; lanNow = lan; try { return peerAllowed(address); } finally { lanNow = was; } };

const tooManyFailures = (address: string) => {
  const f = failures.get(limitKey(address));
  return !!f && f.resetAt > Date.now() && f.count >= 10;
};
const recordFailure = (address: string) => {
  const ip = limitKey(address), now = Date.now();
  if (failures.size > 1024) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
  const f = failures.get(ip);
  if (!f || f.resetAt <= now) failures.set(ip, { count: 1, resetAt: now + 60_000 });
  else f.count++;
};

const send = (res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    ...headers,
  });
  res.end(body);
};

const cookieOf = (req: IncomingMessage) => /(?:^|;\s*)ns_session=([0-9a-f]{64})/.exec(req.headers.cookie ?? '')?.[1];

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const handle = (invoke: Invoke) => async (req: IncomingMessage, res: ServerResponse) => {
  const ip = req.socket.remoteAddress ?? '';
  if (!peerAllowed(ip)) return void req.socket.destroy(); // dropped, no answer
  if (!hosts.includes((req.headers.host ?? '').toLowerCase())) return send(res, 403, 'Forbidden'); // DNS rebinding
  if (tooManyFailures(ip)) return send(res, 429, t('desktop.tooManyAttempts'));
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // Opening the link with the token starts a session, then the token leaves the address bar.
  if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('t')) {
    if (!equal(url.searchParams.get('t') ?? '', token)) { recordFailure(ip); return send(res, 401, t('desktop.wrongLink')); }
    const session = random();
    sessions.add(session);
    return send(res, 303, '', { Location: '/', 'Set-Cookie': `ns_session=${session}; HttpOnly; SameSite=Strict; Path=/` });
  }

  const session = cookieOf(req);
  if (!session || !sessions.has(session)) { recordFailure(ip); return send(res, 401, t('desktop.openLinkFromApp')); }

  if (req.method === 'POST' && url.pathname === '/api/invoke') {
    const origin = req.headers.origin;
    if (origin && origin.toLowerCase() !== `http://${req.headers.host}`.toLowerCase()) return send(res, 403, 'Forbidden');
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, 'Expected JSON');
    try {
      const { channel, args } = JSON.parse(await readBody(req));
      if (typeof channel !== 'string') throw new Error('Bad request');
      const result = await invoke(channel, args, 'http');
      return send(res, 200, JSON.stringify({ result: result ?? null }), { 'Content-Type': 'application/json' });
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e instanceof Error ? e.message : 'Bad request' }), { 'Content-Type': 'application/json' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  const asset = await serve(url.pathname);
  return asset ? send(res, 200, asset.body, { 'Content-Type': asset.type, ...asset.headers }) : send(res, 404, 'Not found');
};

export const webViewStatus = () => ({
  on: servers.length > 0,
  port: PORT,
  lan: servers.length > 0 && lanNow,
  links: servers.length ? hosts.filter(h => !h.startsWith('localhost')).map(h => `http://${h}/?t=${token}`) : [],
});

export const startWebView = async (invoke: Invoke) => {
  if (servers.length) return webViewStatus();
  token = random();
  PORT = options.port ?? 4577;
  lanNow = (options.lan ?? readLan)();
  const addresses = bindAddresses();
  hosts = [`localhost:${PORT}`, ...addresses.map(a => `${a}:${PORT}`)];
  const started: Server[] = [];
  try {
    for (const address of addresses) {
      const server = createServer(handle(invoke));
      server.headersTimeout = options.headerMs ?? HEADER_MS; // slow or silent clients are cut off
      server.requestTimeout = 60_000;
      server.maxConnections = MAX_CONNECTIONS;
      // Before any HTTP is read: peers not allowed are dropped, and a client has HEADER_MS to send a request (Node's own
      // headersTimeout is only swept every 30 s, so a timer per socket does the real work; once a request arrives the socket may idle longer).
      server.on('connection', socket => {
        socket.on('error', () => {});
        if (!peerAllowed(socket.remoteAddress ?? '')) return void socket.destroy();
        socket.setTimeout(options.headerMs ?? HEADER_MS, () => socket.destroy());
      });
      server.on('request', req => { req.socket.setTimeout(60_000); });
      server.on('clientError', (_e, socket) => socket.destroy());
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(PORT, address, resolve); });
      started.push(server);
    }
  } catch (e) {
    started.forEach(s => s.close());
    hosts = [];
    throw e;
  }
  servers = started;
  return webViewStatus();
};

export const stopWebView = async () => {
  const closing = servers;
  servers = [];
  hosts = [];
  token = '';
  sessions.clear();
  failures.clear();
  await Promise.all(closing.map(s => new Promise<void>(resolve => { s.close(() => resolve()); s.closeAllConnections(); })));
  return webViewStatus();
};
