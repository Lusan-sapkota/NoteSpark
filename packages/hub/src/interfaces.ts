// Which addresses the hub listens on, decided by code: loopback and private interface addresses only, never 0.0.0.0.
import { isPrivateAddress } from '@notespark/core';

export interface Iface { address: string; family: string | number; internal: boolean; scopeid?: number }
export type IfaceMap = Record<string, Iface[] | undefined>;

const isLoopback = (a: string) => a === '127.0.0.1' || a === '::1';
const isTunnel = (a: string) => { const m = /^100\.(\d+)\./.exec(a); return !!m && +m[1] >= 64 && +m[1] <= 127; };

// What to bind to. IPv4 only (the phone's client dials IP literals; link-local IPv6 needs a scope id and is skipped).
export const listenAddresses = (ifaces: IfaceMap, o: { lan?: boolean } = {}): string[] => {
  const out = new Set<string>(['127.0.0.1']);
  for (const list of Object.values(ifaces)) for (const i of list ?? []) {
    if (i.internal || (i.family !== 'IPv4' && i.family !== 4)) continue;
    if (!isPrivateAddress(i.address) || isLoopback(i.address) || i.address === '0.0.0.0') continue;
    if (!o.lan && !isTunnel(i.address)) continue; // private LAN (Wi-Fi) addresses only when `lan` is set
    out.add(i.address);
  }
  return [...out];
};

// The address list for the pairing QR: IP literals first (not loopback: a phone cannot use it), a name only if the person set one.
export const pairingAddresses = (hosts: string[], tunnelName?: string, max = 8): string[] => {
  const ips = hosts.filter(h => !isLoopback(h));
  const name = tunnelName && isPrivateAddress(tunnelName) ? [tunnelName] : [];
  return [...ips, ...name].slice(0, max);
};

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
