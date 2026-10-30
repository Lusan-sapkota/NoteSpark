// The web view's door (desktop/src/main/web.ts), private by default (D5): who can reach it, and that the token gates every route.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';

const web = await import('../../../desktop/src/main/web.ts');
const lo = (address: string, internal = false) => ({ address, family: 'IPv4', internal });
// 127.0.0.2 stands in for "the Wi-Fi address": private, bindable here, and not a tunnel address.
const ifaces = () => ({ lo: [lo('127.0.0.1', true)], wlan0: [lo('127.0.0.2')] });
const free = () => new Promise<number>(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const served = async () => ({ type: 'text/html', body: Buffer.from('<p>app</p>') });
const invoke = async (channel: string, args: unknown) => ({ channel, args });

const req = (host: string, port: number, o: { path?: string; method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string; error?: string }>(resolve => {
    const r = http.request({ host, port, path: o.path ?? '/', method: o.method ?? 'GET', headers: { Host: `${host}:${port}`, ...o.headers } }, res => {
      let body = ''; res.on('data', d => (body += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', e => resolve({ headers: {}, body: '', error: (e as NodeJS.ErrnoException).code ?? String(e) }));
    r.end(o.body);
  });

const start = async (lan: boolean, extra = {}) => {
  const port = await free();
  web.configureWebView({ port, lan: () => lan, ifaces, serve: served, ...extra });
  const status = await web.startWebView(invoke as any);
  const token = new URL(status.links.at(-1)!).searchParams.get('t')!;
  return { port, token, status };
};
const signIn = async (port: number, token: string, host = '127.0.0.1') => {
  const r = await req(host, port, { path: `/?t=${token}` });
  assert.equal(r.status, 303);
  return String(r.headers['set-cookie']).split(';')[0];
};

test('private by default: the Wi-Fi address does not answer, this computer does', async () => {
  const { port, status } = await start(false);
  assert.equal(status.lan, false);
  assert.equal((await req('127.0.0.2', port)).error, 'ECONNREFUSED');
  assert.equal((await req('127.0.0.1', port)).status, 401); // answers, and wants the token
  await web.stopWebView();
});

test('with the Wi-Fi switch on, the Wi-Fi address answers too, and the status says so', async () => {
  const { port, status } = await start(true);
  assert.equal(status.lan, true);
  assert.equal((await req('127.0.0.2', port)).status, 401);
  assert.equal((await req('127.0.0.1', port)).status, 401);
  await web.stopWebView();
  assert.equal((await req('127.0.0.2', port)).error, 'ECONNREFUSED'); // stopped means gone
});

test('which peers are let in: public never; Wi-Fi peers only with the switch; this computer and tunnel peers always', () => {
  const ok = web.peerAllowedForTest;
  for (const lan of [false, true]) {
    for (const bad of ['8.8.8.8', '203.0.113.5', '172.32.0.1', '100.63.0.1', '100.128.0.1', '2001:db8::1', 'garbage', '']) assert.equal(ok(bad, lan), false, bad);
    for (const good of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '100.64.0.1', '100.101.102.103', '100.127.255.255']) assert.equal(ok(good, lan), true, good);
  }
  for (const wifi of ['192.168.1.5', '10.0.0.8', '172.16.4.4', '169.254.1.1', 'fd12::1']) { assert.equal(ok(wifi, false), false, wifi); assert.equal(ok(wifi, true), true, wifi); }
});

test('the token gates every route; a wrong one, a foreign Origin and a spoofed Host are refused', async () => {
  const { port, token } = await start(false);
  const host = '127.0.0.1';
  assert.equal((await req(host, port)).status, 401);
  assert.equal((await req(host, port, { path: '/?t=wrong' })).status, 401);
  assert.equal((await req(host, port, { path: '/api/invoke', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"channel":"x"}' })).status, 401);
  assert.equal((await req(host, port, { path: '/images/00000000-0000-0000-0000-000000000000.png' })).status, 401);
  const cookie = await signIn(port, token);
  assert.equal((await req(host, port, { headers: { Cookie: cookie } })).status, 200);
  const post = (headers: Record<string, string>, body = '{"channel":"ping","args":1}') => req(host, port, { path: '/api/invoke', method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body });
  const good = await post({});
  assert.equal(good.status, 200);
  assert.deepEqual(JSON.parse(good.body).result, { channel: 'ping', args: 1 });
  assert.equal((await post({ Origin: 'http://evil.example' })).status, 403);
  assert.equal((await req(host, port, { headers: { Cookie: cookie, Host: 'evil.example' } })).status, 403);
  assert.equal((await req(host, port, { path: '/api/invoke', method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: cookie }, body: 'x' })).status, 415);
  await web.stopWebView();
  // a new start is a new token: the old session and token are dead
  const again = await start(false);
  assert.notEqual(again.token, token);
  assert.equal((await req(host, again.port, { headers: { Cookie: cookie } })).status, 401);
  await web.stopWebView();
});

test('ten wrong tries from one address lock it out, even for a valid session', async () => {
  const { port, token } = await start(false);
  const cookie = await signIn(port, token);
  for (let i = 0; i < 10; i++) await req('127.0.0.1', port, { path: '/?t=nope' });
  assert.equal((await req('127.0.0.1', port, { headers: { Cookie: cookie } })).status, 429);
  await web.stopWebView();
});

test('a client that sends no complete request header is cut off after the header time', async () => {
  const { port } = await start(false, { headerMs: 300 });
  const closedAfter = await new Promise<number>(resolve => {
    const t0 = Date.now();
    const s = net.connect(port, '127.0.0.1', () => s.write('GET / HTTP/1.1\r\nHost: 127.0.0.1'));
    s.on('error', () => {}); s.on('close', () => resolve(Date.now() - t0));
  });
  assert.ok(closedAfter < 3000, `closed after ${closedAfter} ms`);
  await web.stopWebView();
});
