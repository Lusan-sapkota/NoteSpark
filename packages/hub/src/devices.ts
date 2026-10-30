// The hub's list of paired devices: public key, name, added-at, last-seen. One JSON file, written atomically with mode 0600.
// A file that cannot be trusted stops the hub from starting; it never means "allow everyone".
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Clock, HelloPayload, PairingMode } from '@notespark/sync-protocol';

export const FORMAT = 1;
const SEEN_EVERY = 60_000;
const KEY = /^[0-9a-f]{64}$/;

export interface Device { key: string; name: string; addedAt: string; lastSeen: string | null }

export class DeviceListError extends Error {}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

export class DeviceList {
  private devices = new Map<string, Device>();
  private path: string;
  private clock: Clock;
  private dirty = false;
  private lastWrite = 0;
  onRevoke: (key: Uint8Array) => void = () => {};

  private constructor(path: string, clock: Clock) { this.path = path; this.clock = clock; }

  // Missing file: an empty list. Anything else wrong: DeviceListError.
  static open(path: string, clock: Clock): DeviceList {
    const list = new DeviceList(path, clock);
    if (!existsSync(path)) return list;
    const fail = (why: string): never => { throw new DeviceListError(`The device list at ${path} cannot be trusted (${why}). The hub will not start. Fix or delete the file and pair your devices again.`); };
    if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) fail('other users can read or write it');
    let data: unknown;
    try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { return fail('it is not valid JSON'); }
    const d = data as { format?: unknown; devices?: unknown };
    if (!d || d.format !== FORMAT || !Array.isArray(d.devices)) fail('unknown format');
    for (const e of d.devices as Partial<Device>[]) {
      if (!e || typeof e.key !== 'string' || !KEY.test(e.key) || typeof e.name !== 'string' || typeof e.addedAt !== 'string' || Number.isNaN(Date.parse(e.addedAt))
        || !(e.lastSeen === null || (typeof e.lastSeen === 'string' && !Number.isNaN(Date.parse(e.lastSeen))))) fail('an entry is malformed');
      if (list.devices.has(e.key!)) fail('a key appears twice');
      list.devices.set(e.key!, { key: e.key!, name: e.name!, addedAt: e.addedAt!, lastSeen: e.lastSeen ?? null });
    }
    return list;
  }

  has(key: Uint8Array) { return this.devices.has(hex(key)); }
  list(): Device[] { return [...this.devices.values()].map(d => ({ ...d })); }

  add(key: Uint8Array, name: string) {
    const k = hex(key);
    if (this.devices.has(k)) return;
    this.devices.set(k, { key: k, name: name.slice(0, 64), addedAt: new Date(this.clock.now()).toISOString(), lastSeen: null });
    this.save();
  }
  rename(key: Uint8Array, name: string) {
    const d = this.devices.get(hex(key));
    if (!d) return false;
    d.name = name.slice(0, 64);
    this.save();
    return true;
  }
  // Removes the key, then every open connection of that device is closed by `onRevoke`.
  revoke(key: Uint8Array) {
    if (!this.devices.delete(hex(key))) return false;
    this.save();
    this.onRevoke(key);
    return true;
  }
  // Last seen is written at most once a minute per list, so a reconnect loop does not hammer the disk.
  touch(key: Uint8Array) {
    const d = this.devices.get(hex(key));
    if (!d) return;
    d.lastSeen = new Date(this.clock.now()).toISOString();
    this.dirty = true;
    if (this.clock.now() - this.lastWrite >= SEEN_EVERY) this.save();
  }
  flush() { if (this.dirty) this.save(); }

  private save() {
    const body = JSON.stringify({ format: FORMAT, devices: [...this.devices.values()] }, null, 1);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const fd = openSync(tmp, 'w', 0o600);
    try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
    if (process.platform !== 'win32') chmodSync(this.path, 0o600);
    this.dirty = false;
    this.lastWrite = this.clock.now();
  }
}

// For `HubServer`: a known key is welcome; an unknown one only with a valid pairing token, which adds it.
export const authorizer = (devices: DeviceList, pairing: PairingMode) => (key: Uint8Array, hello: HelloPayload): boolean => {
  if (devices.has(key)) { devices.touch(key); return true; }
  if (hello.token && pairing.check(hello.token)) { devices.add(key, hello.name); return true; }
  return false;
};
