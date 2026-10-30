import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { isPrivateAddress } from '@notespark/core';
import { serveAsset } from './assets';

// The web view: the desktop UI bundle plus the same backend API, for a browser on your own network.
// Off until switched on. Private addresses only, a random token, and nothing is stored on disk.
type Invoke = (channel: string, args: unknown, from: 'ipc' | 'http') => Promise<unknown>;

const PORT = 4577;
const MAX_BODY = 25_000_000; // room for one picture as base64 (15 MB limit in assets.ts); only read after sign-in
let servers: Server[] = [];
let token = '';
let hosts: string[] = []; // host:port values we answer to (Host header check against DNS rebinding)
const sessions = new Set<string>();
const failures = new Map<string, { count: number; resetAt: number }>();

const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const random = () => randomBytes(32).toString('hex');

// Addresses worth offering: this computer plus every private IPv4 address of a network interface.
const privateAddresses = () => [
  '127.0.0.1',
  ...Object.values(networkInterfaces()).flatMap(list => (list ?? []).filter(i => i.family === 'IPv4' && !i.internal && isPrivateAddress(i.address)).map(i => i.address)),
];

const tooManyFailures = (ip: string) => {
  const f = failures.get(ip);
  return !!f && f.resetAt > Date.now() && f.count >= 10;
};
const recordFailure = (ip: string) => {
  const f = failures.get(ip);
  if (!f || f.resetAt <= Date.now()) failures.set(ip, { count: 1, resetAt: Date.now() + 60_000 });
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
  if (!isPrivateAddress(ip)) return send(res, 403, 'Forbidden');
  if (!hosts.includes((req.headers.host ?? '').toLowerCase())) return send(res, 403, 'Forbidden'); // DNS rebinding
  if (tooManyFailures(ip)) return send(res, 429, 'Too many attempts, wait a minute');
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // Opening the link with the token starts a session, then the token leaves the address bar.
  if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('t')) {
    if (!equal(url.searchParams.get('t') ?? '', token)) { recordFailure(ip); return send(res, 401, 'Wrong or expired link'); }
    const session = random();
    sessions.add(session);
    return send(res, 303, '', { Location: '/', 'Set-Cookie': `ns_session=${session}; HttpOnly; SameSite=Strict; Path=/` });
  }

  const session = cookieOf(req);
  if (!session || !sessions.has(session)) { recordFailure(ip); return send(res, 401, 'Open the link from NoteSpark on your computer'); }

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
  const asset = await serveAsset(url.pathname);
  return asset ? send(res, 200, asset.body, { 'Content-Type': asset.type, ...asset.headers }) : send(res, 404, 'Not found');
};

export const webViewStatus = () => ({
  on: servers.length > 0,
  port: PORT,
  links: servers.length ? hosts.filter(h => !h.startsWith('localhost')).map(h => `http://${h}/?t=${token}`) : [],
});

export const startWebView = async (invoke: Invoke) => {
  if (servers.length) return webViewStatus();
  token = random();
  const addresses = privateAddresses();
  hosts = [`localhost:${PORT}`, ...addresses.map(a => `${a}:${PORT}`)];
  const started: Server[] = [];
  try {
    for (const address of addresses) {
      const server = createServer(handle(invoke));
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
