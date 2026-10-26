// The Markdown mirror (docs/architecture/sync-architecture.md section 8): one .md file per note, kept in step both ways.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type NoteState, type SyncStore, editSize } from '@notespark/sync';
import { type FSWatcher, watch } from 'chokidar';

export interface MirrorStatus {
  state: 'off' | 'ok' | 'paused' | 'not mirrored';
  message: string;
}

export interface MirrorOptions {
  store: SyncStore;
  syncId: string;
  folder: string; // the mirror folder; this profile's files go in <folder>/<profileName>
  profileName: string;
  isProtected?: boolean;
  debounceMs?: number;
  retryMs?: number;
  onStatus?: (status: MirrorStatus) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const sanitize = (title: string) => title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+/, '').slice(0, 120).trim() || 'Untitled';

export const render = (uuid: string, n: NoteState) =>
  `---\nuuid: ${uuid}\ncreated: ${n.createdAt}\nupdated: ${n.updatedAt}\npinned: ${n.isPinned}\narchived: ${n.isArchived}\n---\n${n.content}`;

export interface Parsed {
  uuid: string | null;
  pinned: boolean;
  archived: boolean;
  body: string;
}

// Broken front matter (no valid uuid, no closing line) is not dropped: the whole file becomes the body.
export const parse = (raw: string): Parsed => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const fields = new Map<string, string>();
  if (m) for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) fields.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
  const uuid = fields.get('uuid');
  if (!m || !uuid || !UUID.test(uuid)) return { uuid: null, pinned: false, archived: false, body: raw };
  return { uuid, pinned: fields.get('pinned') === 'true', archived: fields.get('archived') === 'true', body: raw.slice(m[0].length) };
};

export class Mirror {
  status: MirrorStatus = { state: 'off', message: 'Mirroring is off.' };
  private o: MirrorOptions;
  private dir: string;
  private index = new Map<string, { path: string; texts: string[] }>(); // uuid -> file, and the last few bodies written or read
  private byPath = new Map<string, string>();
  private written = new Map<string, string>(); // path -> hash of what this hub wrote, so its own events are ignored
  private removed = new Set<string>(); // paths this hub deleted
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private chain: Promise<void> = Promise.resolve();
  private busy = 0;
  private watcher: FSWatcher | null = null;
  private offs: (() => void)[] = [];
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(o: MirrorOptions) {
    this.o = o;
    this.dir = join(o.folder, sanitize(o.profileName));
  }

  private set(state: MirrorStatus['state'], message: string) {
    this.status = { state, message };
    this.o.onStatus?.(this.status);
  }
  private ms() { return this.o.debounceMs ?? 300; }

  async start() {
    if (this.o.isProtected) return this.set('not mirrored', 'Protected profiles are not mirrored.');
    await this.run(() => this.writeAll());
    if (this.status.state === 'paused') this.scheduleRetry();
    this.offs.push(this.o.store.onNoteChange(this.o.syncId, uuid => this.later(`n:${uuid}`, () => this.pushNote(uuid))));
    this.watcher = watch(this.dir, { ignoreInitial: true, ignored: p => basename(p).startsWith('.') });
    this.watcher.on('add', p => this.later(`f:${p}`, () => this.pullFile(p))).on('change', p => this.later(`f:${p}`, () => this.pullFile(p)));
    this.watcher.on('unlink', p => this.later(`f:${p}`, () => this.unlinked(p), 2));
    this.watcher.on('error', () => this.set('paused', 'The mirror folder cannot be watched.'));
    await new Promise<void>(resolve => this.watcher!.once('ready', () => resolve()));
  }

  async stop() {
    this.offs.forEach(off => off());
    this.offs = [];
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.retry) clearTimeout(this.retry);
    await this.watcher?.close();
    this.watcher = null;
    await this.chain;
    this.set('off', 'Mirroring is off.');
  }

  // Resolves when nothing is waiting or running.
  async idle() {
    for (let quiet = 0; quiet < 8; ) {
      await new Promise(resolve => setTimeout(resolve, 25));
      quiet = this.timers.size === 0 && this.busy === 0 ? quiet + 1 : 0;
    }
  }

  private later(key: string, fn: () => Promise<void>, factor = 1) {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.run(fn); }, this.ms() * factor));
  }

  private run(fn: () => Promise<void>) {
    this.busy++;
    const next = this.chain.then(async () => {
      try { await fn(); } catch (e) { this.set('paused', `The mirror folder cannot be written: ${(e as Error).message}`); this.scheduleRetry(); }
    }).finally(() => { this.busy--; });
    this.chain = next;
    return next;
  }

  private scheduleRetry() {
    if (this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; void this.run(() => this.writeAll()); }, this.o.retryMs ?? 30_000);
  }

  // ---- notes to files

  private async writeAll() {
    await mkdir(this.dir, { recursive: true });
    const notes = (await this.o.store.allNotes(this.o.syncId)).sort((a, b) => (a.createdAt + a.uuid < b.createdAt + b.uuid ? -1 : 1));
    for (const n of notes) await this.pushNote(n.uuid);
    this.set('ok', 'Mirroring.');
  }

  // Title.md, then Title (2).md ...; a note keeps its file while its title still matches it.
  private pathFor(uuid: string, title: string) {
    const stem = sanitize(title);
    const current = this.index.get(uuid)?.path;
    if (current && basename(current, '.md').replace(/ \(\d+\)$/, '') === stem) return current;
    for (let n = 1; ; n++) {
      const path = join(this.dir, `${n === 1 ? stem : `${stem} (${n})`}.md`);
      const owner = this.byPath.get(path);
      if (!owner || owner === uuid) return path;
    }
  }

  private async pushNote(uuid: string) {
    const note = await this.o.store.note(this.o.syncId, uuid);
    const old = this.index.get(uuid)?.path;
    if (!note || note.deletedAt) {
      if (old) await this.drop(uuid, old);
      return;
    }
    const path = this.pathFor(uuid, note.title);
    const text = render(uuid, note);
    this.remember(uuid, path, note.content);
    this.byPath.set(path, uuid);
    const existing = await readFile(path, 'utf8').catch(() => null);
    // An outside edit still waiting for its event is imported first, never overwritten.
    if (existing !== null && this.written.has(path) && this.written.get(path) !== hash(existing)) return this.pullFile(path);
    if (existing !== text) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
      await writeFile(tmp, text);
      this.written.set(path, hash(text));
      await rename(tmp, path);
    }
    if (old && old !== path) await this.drop(uuid, old, true);
  }

  private remember(uuid: string, path: string, text: string) {
    const texts = this.index.get(uuid)?.texts ?? [];
    this.index.set(uuid, { path, texts: [...texts.filter(t => t !== text), text].slice(-5) });
  }

  // An editor that has not reloaded saves an older text: the base is the recent text closest to what was saved.
  private baseFor(uuid: string | null, edited: string) {
    const texts = uuid ? this.index.get(uuid)?.texts : undefined;
    if (!texts?.length) return null;
    return texts.reduce((best, t) => (editSize(t, edited) <= editSize(best, edited) ? t : best));
  }

  private async drop(uuid: string, path: string, keepIndex = false) {
    this.removed.add(path);
    this.written.delete(path);
    this.byPath.delete(path);
    if (!keepIndex) this.index.delete(uuid);
    await rm(path, { force: true });
  }

  // ---- files to notes

  private async pullFile(path: string) {
    const raw = await readFile(path, 'utf8').catch(() => null);
    if (raw === null || this.written.get(path) === hash(raw)) return;
    this.written.set(path, hash(raw));
    const parsed = parse(raw);
    let uuid = parsed.uuid;
    const at = uuid ? this.index.get(uuid) : undefined;
    // The same uuid in two files: the new one is a copy, so it becomes a note of its own.
    if (uuid && at && at.path !== path && (await readFile(at.path, 'utf8').catch(() => null)) !== null) uuid = null;
    const known = uuid ? await this.o.store.note(this.o.syncId, uuid) : null;
    const stem = basename(path, '.md');
    const kept = known && (this.index.get(uuid!)?.path === path || sanitize(known.title) === stem);
    const id = await this.o.store.applyFile(this.o.syncId, uuid, {
      base: this.baseFor(uuid, parsed.body),
      title: kept ? known!.title : stem,
      content: parsed.body,
      isPinned: parsed.pinned,
      isArchived: parsed.archived,
    });
    const previous = this.index.get(id)?.path;
    if (previous && previous !== path) this.byPath.delete(previous);
    this.remember(id, path, parsed.body);
    this.byPath.set(path, id);
    await this.pushNote(id);
  }

  private async unlinked(path: string) {
    if (this.removed.delete(path)) return;
    if (await readFile(path, 'utf8').catch(() => null) !== null) return this.pullFile(path);
    const uuid = this.byPath.get(path);
    if (!uuid || this.index.get(uuid)?.path !== path) return;
    // Renamed rather than deleted? Find the uuid in another file.
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!name.endsWith('.md')) continue;
      const other = join(this.dir, name);
      const raw = await readFile(other, 'utf8').catch(() => null);
      if (raw !== null && parse(raw).uuid === uuid) return this.pullFile(other);
    }
    this.byPath.delete(path);
    this.index.delete(uuid);
    await this.o.store.binNote(this.o.syncId, uuid); // deleting a file means the bin, never an erase
  }

  // Rebuild a lost hub database: every file with a uuid becomes that note again unless the hub already has it.
  static async rebuild(store: SyncStore, syncId: string, dir: string): Promise<number> {
    let made = 0;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith('.md')) continue;
      const p = parse(await readFile(join(dir, name), 'utf8'));
      if (!p.uuid || (await store.note(syncId, p.uuid))) continue;
      await store.applyFile(syncId, p.uuid, { base: null, title: basename(name, '.md'), content: p.body, isPinned: p.pinned, isArchived: p.archived });
      made++;
    }
    return made;
  }
}
