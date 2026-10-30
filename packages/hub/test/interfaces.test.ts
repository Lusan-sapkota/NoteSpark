import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type IfaceMap, listenAddresses, pairingAddresses } from '../src/interfaces.ts';

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal });
const fake: IfaceMap = {
  lo: [v4('127.0.0.1', true), { address: '::1', family: 'IPv6', internal: true }],
  wlan0: [v4('192.168.1.20'), { address: 'fe80::1', family: 'IPv6', internal: false, scopeid: 2 }],
  eth0: [v4('203.0.113.9')], // public
  docker0: [v4('172.17.0.1')],
  tailscale0: [v4('100.101.102.103')],
  weird: [v4('0.0.0.0'), v4('169.254.1.1'), v4('172.32.0.1'), v4('100.63.0.1'), v4('100.128.0.1'), v4('8.8.8.8')],
};

test('private interfaces only, never 0.0.0.0, never a public address', () => {
  const all = listenAddresses(fake, { lan: true });
  assert.deepEqual(all.sort(), ['127.0.0.1', '169.254.1.1', '172.17.0.1', '100.101.102.103', '192.168.1.20'].sort());
  for (const bad of ['0.0.0.0', '203.0.113.9', '8.8.8.8', '172.32.0.1', '100.63.0.1', '100.128.0.1', '::']) assert.ok(!all.includes(bad), bad);
});

test('without the LAN switch only this computer and tunnel addresses', () => {
  assert.deepEqual(listenAddresses(fake).sort(), ['100.101.102.103', '127.0.0.1']);
  assert.deepEqual(listenAddresses({}), ['127.0.0.1']);
});

test('a network change gives a different list: Wi-Fi gone, another network appears', () => {
  const after: IfaceMap = { lo: fake.lo, wlan0: [v4('10.0.0.7')] };
  assert.deepEqual(listenAddresses(after, { lan: true }).sort(), ['10.0.0.7', '127.0.0.1']);
  assert.ok(!listenAddresses(after, { lan: true }).includes('192.168.1.20'));
});

test('the QR list: IP literals first, no loopback, a name only if it passes the network rule, at most 8', () => {
  assert.deepEqual(pairingAddresses(['127.0.0.1', '192.168.1.20', '100.101.102.103'], 'laptop.tail1234.ts.net'), ['192.168.1.20', '100.101.102.103', 'laptop.tail1234.ts.net']);
  assert.deepEqual(pairingAddresses(['127.0.0.1', '10.0.0.1'], 'example.com'), ['10.0.0.1']); // a public name is dropped
  assert.deepEqual(pairingAddresses(['127.0.0.1']), []);
  assert.equal(pairingAddresses(Array.from({ length: 12 }, (_, i) => `10.0.0.${i + 1}`), 'a.local').length, 8);
});
