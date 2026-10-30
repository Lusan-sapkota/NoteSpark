// Sync on the desktop, main-process side (docs/architecture/sync-architecture.md section 2): owns the databases, the hub key,
// hub.json and the supervised hub process. No Electron imports: the process spawn, the folder dialog and the window events are injected,
// so this file runs in plain Node tests.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import * as SecureStore from 'expo-secure-store';
import { HubController, type IfaceMap, type ProfileSource, type Spawned, listenAddresses, multiStore, sameSet } from '@notespark/hub';
import { deviceId, generateKeypair, keypairFromPrivate, realClock } from '@notespark/sync-protocol';
import { dataDir } from '@notespark/node-shims/paths';
import { linkProfile, linkedSyncId } from '../../../mobile/src/storage/crdt';
import * as database from '../../../mobile/src/storage/database';
import * as profiles from '../../../mobile/src/storage/profiles';
import { storageStore } from '../../../mobile/src/storage/syncStore';

export const DEFAULT_PORT = 4578;
const MAX_SYNCED_PROFILES = 20; // a device cannot make more profiles than this here
const KEY_NAME = 'hubKey';

// hub.json: settings only, no secrets (the key is in the keyring, the device list in devices.json).
export interface HubSettings {
  format: 1;
  on: boolean;
  name: string;
  port: number;
  tunnelName: string;
  acceptNew: boolean; // a device may add a profile here
  profiles: string[]; // local profile ids with sync on
  syncIds: Record<string, string>; // local profile id -> sync id, remembered so a locked profile can still be named
  mirrorFolder: string | null;
  webLan: boolean; // the web view also listens on the Wi-Fi (private LAN) addresses
}
const defaults = (): HubSettings => ({ format: 1, on: false, name: 'My computer', port: DEFAULT_PORT, tunnelName: '', acceptNew: false, profiles: [], syncIds: {}, mirrorFolder: null, webLan: false });

const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.length <= max ? v : fallback);
// A damaged file means defaults (sync off), never "more open": every field is checked.
export const readSettings = (path: string): HubSettings => {
  const d = defaults();
  let j: any;
  try { j = JSON.parse(readFileSync(path, 'utf8')); } catch { return d; }
  if (!j || j.format !== 1) return d;
  return {
    format: 1, on: j.on === true, name: str(j.name, 64, d.name), tunnelName: str(j.tunnelName, 253, ''),
    port: Number.isInteger(j.port) && j.port >= 1024 && j.port <= 65535 ? j.port : d.port,
    acceptNew: j.acceptNew === true, webLan: j.webLan === true,
    profiles: Array.isArray(j.profiles) ? j.profiles.filter((p: unknown) => typeof p === 'string' && p.length <= 64) : [],
    syncIds: j.syncIds && typeof j.syncIds === 'object' ? Object.fromEntries(Object.entries(j.syncIds).filter(([k, v]) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v as string) && k.length <= 64)) as Record<string, string> : {},
    mirrorFolder: typeof j.mirrorFolder === 'string' && j.mirrorFolder.length < 4096 ? j.mirrorFolder : null,
  };
};
const writeSettings = (path: string, s: HubSettings) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 });
  renameSync(tmp, path);
  if (process.platform !== 'win32') chmodSync(path, 0o600);
};

export interface SyncHubDeps {
  spawn: () => Spawned;
  isReady: () => boolean; // the profile open in the window is unlocked (phase 'ready')
  announce?: () => void; // tell the window something changed
  chooseFolder?: () => Promise<string | null>; // the system folder dialog (main process)
  ifaces?: () => IfaceMap;
  dir?: string;
  watchMs?: number;
}

export class SyncHub {
  settings: HubSettings;
  controller: HubController;
  mirror: Record<string, { state: string; message: string }> = {};
  paired: string | null = null; // name of a device that just paired, for "New device added"
  private d: SyncHubDeps;
  private dir: string;
  private own = new Map<string, SQLiteDb>();
  private multi: ReturnType<typeof multiStore>;
  private watch: NodeJS.Timeout | null = null;
  private lastHosts: string[] = [];

  constructor(d: SyncHubDeps) {
    this.d = d;
    this.dir = d.dir ?? dataDir();
    this.settings = readSettings(join(this.dir, 'hub.json'));
    this.multi = multiStore(this.source());
    this.controller = new HubController({
      spawn: d.spawn, store: this.multi.store, clock: realClock,
      config: async () => ({ dir: this.dir, name: this.settings.name, keyHex: await this.key(), port: this.settings.port, hosts: this.hosts(), tunnelName: this.settings.tunnelName || undefined }),
      onStatus: s => { if (s.state === 'running') void this.applyMirror(); d.announce?.(); },
      onEvent: ev => {
        if (ev?.type === 'paired') { this.paired = String(ev.name).slice(0, 64); d.announce?.(); }
        else if (ev?.type === 'mirror') { this.mirror[ev.syncId] = ev.status; d.announce?.(); }
      },
    });
  }

  private save() { writeSettings(join(this.dir, 'hub.json'), this.settings); }
  private hosts() { return listenAddresses((this.d.ifaces ?? networkInterfaces)() as IfaceMap, { lan: true }); }

  // The hub key: generated once, private half in the keyring. No keyring: sync refuses to turn on.
  private async key() {
    const have = await SecureStore.getItemAsync(KEY_NAME);
    if (have && /^[0-9a-f]{64}$/.test(have)) return have;
    const hex = Buffer.from(generateKeypair().priv).toString('hex');
    await SecureStore.setItemAsync(KEY_NAME, hex);
    return hex;
  }

  // What the hub process may reach: only profiles with the switch on, and a protected one only while it is the unlocked profile.
  private source(): ProfileSource {
    const exists = async (id: string) => (await profiles.getProfiles()).some(p => p.id === id); // not binned, not deleted
    const name = async (id: string) => (await profiles.getProfiles()).find(p => p.id === id)?.name ?? id;
    const unlocked = async (id: string) => !(await profiles.hasProfilePin(id)) || (database.isProfileDatabaseOpen(id) && this.d.isReady());
    return {
      synced: () => this.settings.profiles,
      describe: async id => ({ name: await name(id), isProtected: await profiles.hasProfilePin(id), unlocked: await unlocked(id), exists: await exists(id) }),
      syncIdOf: async id => this.settings.syncIds[id] ?? null,
      open: async id => {
        if (!(await exists(id)) || !(await unlocked(id))) return null; // never open (or create) a database for a profile that is gone
        const store = storageStore(await this.handle(id), await name(id), id);
        const [info] = await store.profiles();
        if (info && this.settings.syncIds[id] !== info.syncId) { this.settings.syncIds[id] = info.syncId; this.save(); }
        return store;
      },
      adopt: async (syncId, label) => {
        if (!this.settings.acceptNew || this.settings.profiles.length >= MAX_SYNCED_PROFILES) return null;
        const profile = await profiles.addProfile(label.slice(0, 40) || 'From a device');
        await linkProfile(await this.handle(profile.id), syncId, new Map());
        this.settings.profiles.push(profile.id);
        this.settings.syncIds[profile.id] = syncId;
        this.save();
        this.d.announce?.();
        return profile.id;
      },
    };
  }

  // The window's own connection for the profile it has open (one writer per file, and its listeners see local edits),
  // otherwise this hub's own connection.
  private async handle(id: string): Promise<SQLiteDb> {
    if (database.isProfileDatabaseOpen(id)) return database.db;
    let c = this.own.get(id);
    if (!c) { c = await database.openProfileConnection(id); await database.initDatabase(c); this.own.set(id, c); }
    return c;
  }
  private async closeOwn() {
    const all = [...this.own.values()];
    this.own.clear();
    await Promise.all(all.map(c => c.closeAsync().catch(() => {})));
  }

  // The active profile changed, a lock fired, a profile was re-encrypted, or a switch moved.
  async profilesChanged() {
    await this.closeOwn();
    await this.multi.rebind();
    await this.applyMirror();
    this.d.announce?.();
  }

  async applyMirror() {
    if (this.controller.status.state !== 'running') return;
    const list: { syncId: string; name: string; isProtected: boolean }[] = [];
    for (const id of this.settings.profiles) {
      const syncId = this.settings.syncIds[id];
      if (!syncId) continue;
      list.push({ syncId, name: (await profiles.getProfiles()).find(p => p.id === id)?.name ?? id, isProtected: await profiles.hasProfilePin(id) });
    }
    this.mirror = {};
    await this.controller.call('setMirror', { folder: this.settings.mirrorFolder, profiles: list }).catch(() => {});
  }

  async start() {
    if (!this.settings.on) return;
    try { await this.key(); } catch (e) { return void this.problem(e instanceof Error ? e.message : String(e)); }
    this.controller.start();
    this.lastHosts = this.hosts();
    this.watch = setInterval(() => void this.refreshHosts(), this.d.watchMs ?? 5000);
    this.watch.unref();
  }
  private problem(message: string) { this.controller.status = { state: 'problem', message }; this.d.announce?.(); }

  // Re-evaluated when the network changes: only the listeners that went away or appeared are touched.
  async refreshHosts() {
    const now = this.hosts();
    if (sameSet(now, this.lastHosts)) return;
    this.lastHosts = now;
    await this.controller.call('setHosts', now).catch(() => {});
    this.d.announce?.();
  }

  async stop() {
    this.lastCode = null;
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.controller.stop();
    await this.closeOwn();
  }

  async setOn(on: boolean) {
    this.settings.on = on;
    this.save();
    if (on) await this.start(); else await this.stop();
    this.d.announce?.();
  }

  // Turn a profile's sync switch on or off. On: a profile that was never linked gets a new sync id here.
  async setProfileSync(id: string, on: boolean) {
    if (!(await profiles.getProfiles()).some(p => p.id === id)) throw new Error('There is no such profile.'); // never create a database for an unknown id
    if (!on) {
      this.settings.profiles = this.settings.profiles.filter(p => p !== id);
      this.save();
      return this.profilesChanged();
    }
    if ((await profiles.hasProfilePin(id)) && !(database.isProfileDatabaseOpen(id) && this.d.isReady())) throw new Error('Unlock this profile on your computer to sync it.');
    const db = await this.handle(id);
    const syncId = (await linkedSyncId(db)) ?? randomUUID();
    if (!(await linkedSyncId(db))) await linkProfile(db, syncId, new Map());
    this.settings.syncIds[id] = syncId;
    if (!this.settings.profiles.includes(id)) this.settings.profiles.push(id);
    this.save();
    await this.profilesChanged();
  }

  update(patch: Partial<Pick<HubSettings, 'name' | 'tunnelName' | 'acceptNew' | 'mirrorFolder' | 'webLan'>>) {
    if (typeof patch.name === 'string') this.settings.name = patch.name.trim().slice(0, 64) || 'My computer';
    if (typeof patch.tunnelName === 'string') this.settings.tunnelName = patch.tunnelName.trim().slice(0, 253);
    if (typeof patch.acceptNew === 'boolean') this.settings.acceptNew = patch.acceptNew;
    if (typeof patch.webLan === 'boolean') this.settings.webLan = patch.webLan;
    if ('mirrorFolder' in patch) this.settings.mirrorFolder = patch.mirrorFolder || null;
    this.save();
  }

  async hubId() {
    try { return deviceId(keypairFromPrivate(Uint8Array.from(Buffer.from(await this.key(), 'hex'))).pub); } catch { return null; }
  }

  // Everything the Sync screen shows. Never contains the pairing token or any key.
  async status() {
    const s = this.settings, c = this.controller.status;
    const list = [];
    for (const p of await profiles.getProfiles()) {
      const isProtected = await profiles.hasProfilePin(p.id);
      list.push({ id: p.id, name: p.name, synced: s.profiles.includes(p.id), isProtected, locked: isProtected && !(database.isProfileDatabaseOpen(p.id) && this.d.isReady()), mirror: s.syncIds[p.id] ? this.mirror[s.syncIds[p.id]] ?? null : null });
    }
    return {
      on: s.on, state: s.on ? c.state : 'stopped', message: c.message ?? null, port: c.port ?? null, hosts: c.hosts ?? [],
      name: s.name, tunnelName: s.tunnelName, acceptNew: s.acceptNew, mirrorFolder: s.mirrorFolder, webLan: s.webLan, hubId: s.on ? await this.hubId() : null,
      restarts: this.controller.restarts, paired: this.paired, profiles: list,
    };
  }

  // The channel the window uses (desktop window only, never the web view: a pairing token must not reach a browser).
  async call(op: string, a: any): Promise<unknown> {
    const key = (v: unknown) => { if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new Error('Bad device'); return v; };
    switch (op) {
      case 'status': return this.status();
      case 'setOn': await this.setOn(a === true); return this.status();
      case 'update': this.update({ name: a?.name, tunnelName: a?.tunnelName, acceptNew: a?.acceptNew, webLan: a?.webLan }); await this.restartIf(a); return this.status();
      case 'pairStart': {
        const r = (await this.controller.call('pairStart')) as { code: string; expiresAt: number } | null;
        this.lastCode = r ? { code: r.code, expiresAt: r.expiresAt } : null;
        return r;
      }
      case 'pairCancel': this.lastCode = null; return this.controller.call('pairCancel');
      case 'pairState': { const r = (await this.controller.call('pairState')) as { active: boolean }; if (!r.active) this.lastCode = null; return r; }
      case 'devices': return this.controller.call('devices');
      case 'rename': return this.controller.call('rename', { key: key(a?.key), name: String(a?.name ?? '').slice(0, 64) });
      case 'revoke': return this.controller.call('revoke', { key: key(a?.key) });
      case 'profileSync': await this.setProfileSync(String(a?.id), a?.on === true); return this.status();
      case 'chooseFolder': { const f = await this.d.chooseFolder?.(); if (f) { this.update({ mirrorFolder: f }); await this.applyMirror(); } return this.status(); }
      case 'clearFolder': this.update({ mirrorFolder: null }); await this.applyMirror(); return this.status();
      case 'diagnostics': return this.controller.call('diagnostics');
      case 'copyText': return this.copyText(a === 'diagnostics' ? 'diagnostics' : 'code');
      case 'ackPaired': this.paired = null; return null;
      default: throw new Error(`Unknown sync call: ${op}`);
    }
  }
  private lastCode: { code: string; expiresAt: number } | null = null;
  // Text for the clipboard, made here so the page never has to hold it. The pairing code is only available until it expires.
  async copyText(what: 'code' | 'diagnostics'): Promise<string> {
    if (what === 'diagnostics') return ((await this.controller.call('diagnostics')) as string[]).join('\n');
    if (!this.lastCode || this.lastCode.expiresAt <= Date.now()) { this.lastCode = null; throw new Error('The code has expired. Start again to get a new one.'); }
    return this.lastCode.code;
  }
  // A new computer name or tunnel name only reaches a QR made after it, and the hub process reads both at start.
  private async restartIf(a: any) {
    if (this.settings.on && a && (typeof a.name === 'string' || typeof a.tunnelName === 'string')) { await this.stop(); await this.start(); }
  }
}

type SQLiteDb = Awaited<ReturnType<typeof database.openProfileConnection>>;