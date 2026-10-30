// Everything the hub does that is not storage: the key, device list, pairing, listeners per address, the Markdown mirror.
// Plain Node (no Electron): the desktop runs it in a utility process, the Docker image in the main process.
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { SyncStore } from '@notespark/sync';
import { type Clock, Hub, type Keypair, PairingMode, deviceId, pairingCode, pairingUri, TOKEN_TTL } from '@notespark/sync-protocol';
import { DeviceList, authorizer } from './devices.ts';
import { pairingAddresses, sameSet } from './interfaces.ts';
import { Mirror, type MirrorStatus } from './mirror.ts';
import { HubServer } from './wsServer.ts';

export interface HostOptions {
  store: SyncStore;
  dir: string; // devices.json lives here
  name: string;
  hubKey: Keypair;
  port: number; // preferred; 0 or a taken port falls back to a free one
  hosts: string[];
  tunnelName?: string;
  clock: Clock;
  hash: (d: Uint8Array) => Uint8Array;
  onEvent?: (e: HostEvent) => void;
}
export type HostEvent = { type: 'paired'; name: string } | { type: 'log'; line: string } | { type: 'mirror'; syncId: string; status: MirrorStatus };

const RING = 500;
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

export class HubHost {
  readonly devices: DeviceList;
  readonly pairing: PairingMode;
  port = 0;
  hosts: string[] = [];
  skipped: string[] = []; // addresses that could not be bound
  private o: HostOptions;
  private hub: Hub;
  private servers = new Map<string, HubServer>();
  private mirrors = new Map<string, Mirror>();
  private ring: string[] = [];
  private pairExpires = 0;
  private stopped = false;

  // Throws DeviceListError when devices.json cannot be trusted: the hub does not start, and that is never "allow everyone".
  constructor(o: HostOptions) {
    this.o = o;
    this.devices = DeviceList.open(join(o.dir, 'devices.json'), o.clock);
    this.pairing = new PairingMode(o.clock);
    this.hub = new Hub(o.store, o.clock, o.hash);
    this.devices.onRevoke = key => { for (const s of this.servers.values()) s.closeDevice(key); };
  }

  log(line: string) {
    this.ring.push(`${new Date(this.o.clock.now()).toISOString()} ${line}`);
    if (this.ring.length > RING) this.ring.shift();
    this.o.onEvent?.({ type: 'log', line });
  }
  // For "Copy diagnostics": events only, never note text or titles.
  diagnostics() { return [...this.ring]; }

  private serverFor(host: string, port: number) {
    const base = authorizer(this.devices, this.pairing);
    return new HubServer({
      host, port, hubKey: this.o.hubKey, name: this.o.name, hub: this.hub, clock: this.o.clock,
      authorize: (key, hello) => {
        const known = this.devices.has(key);
        const ok = base(key, hello);
        if (ok && !known) { this.log('new device added'); this.o.onEvent?.({ type: 'paired', name: hello.name }); }
        return ok;
      },
      stillKnown: key => this.devices.has(key),
      log: e => this.log(e),
    });
  }

  // Listens on every address, one port for all (the QR carries it). A taken preferred port falls back to a free one.
  async start() {
    this.stopped = false;
    await this.setHosts(this.o.hosts);
  }

  async setHosts(hosts: string[]) {
    if (this.stopped) return;
    for (const h of hosts) if (h === '0.0.0.0' || h === '::') throw new Error('The hub never listens on every address');
    for (const [h, s] of [...this.servers]) if (!hosts.includes(h)) { this.servers.delete(h); await s.close(); this.log(`stopped listening on ${h}`); }
    for (const h of hosts) {
      if (this.servers.has(h)) continue;
      let s = this.serverFor(h, this.port || this.o.port);
      try { await s.listen(); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || this.port) { this.skipped.push(h); this.log(`cannot listen on ${h}`); continue; }
        s = this.serverFor(h, 0); // the preferred port is taken
        try { await s.listen(); } catch { this.skipped.push(h); this.log(`cannot listen on ${h}`); continue; }
        this.log('the preferred port is taken, using a free one');
      }
      this.port = (s.address() as AddressInfo).port;
      this.servers.set(h, s);
      this.log(`listening on ${h}`);
    }
    this.hosts = [...this.servers.keys()];
  }
  hostsChanged(hosts: string[]) { return !sameSet(hosts, this.hosts); }

  // The link and code for "Add a device". Null while pairing is locked. The token exists only in the returned value.
  pairStart() {
    const token = this.pairing.start();
    if (!token) return null;
    this.pairExpires = this.o.clock.now() + TOKEN_TTL;
    const link = { hubKey: this.o.hubKey.pub, token, port: this.port, name: this.o.name, addresses: pairingAddresses(this.hosts, this.o.tunnelName) };
    return { uri: pairingUri(link), code: pairingCode(link), hubId: deviceId(this.o.hubKey.pub), expiresAt: this.pairExpires, addresses: link.addresses };
  }
  pairCancel() { this.pairing.cancel(); }
  pairState() { return { active: this.pairing.active, locked: this.pairing.locked, expiresAt: this.pairExpires }; }

  deviceList() { return this.devices.list().map(d => ({ ...d, id: deviceId(Uint8Array.from(Buffer.from(d.key, 'hex'))) })); }
  rename(keyHex: string, name: string) { return this.devices.rename(Uint8Array.from(Buffer.from(keyHex, 'hex')), name); }
  revoke(keyHex: string) { return this.devices.revoke(Uint8Array.from(Buffer.from(keyHex, 'hex'))); }

  // Markdown mirror per synced, unprotected profile. A folder of null turns every mirror off.
  async setMirror(folder: string | null, profiles: { syncId: string; name: string; isProtected: boolean }[]) {
    for (const m of this.mirrors.values()) await m.stop();
    this.mirrors.clear();
    if (!folder) return;
    for (const p of profiles) {
      const m = new Mirror({ store: this.o.store, syncId: p.syncId, folder, profileName: p.name, isProtected: p.isProtected, onStatus: status => this.o.onEvent?.({ type: 'mirror', syncId: p.syncId, status }) });
      this.mirrors.set(p.syncId, m);
      await m.start();
    }
  }
  mirrorStatus() { return Object.fromEntries([...this.mirrors].map(([id, m]) => [id, m.status])); }

  async stop() {
    this.stopped = true;
    this.pairing.cancel();
    for (const m of this.mirrors.values()) await m.stop();
    this.mirrors.clear();
    this.hub.stop();
    for (const s of this.servers.values()) await s.close();
    this.servers.clear();
    this.hosts = [];
    this.devices.flush();
  }
  key() { return hex(this.o.hubKey.pub); }
}
