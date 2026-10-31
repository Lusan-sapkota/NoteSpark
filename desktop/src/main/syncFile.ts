// The sync file for the desktop window (docs/prompts/sync-file-session.md): the work happens here, in the main process, where the
// open profile's storage is; the window only asks. Dialogs are injected (backend.ts gives the real ones), so this has no Electron
// import and runs in tests. Passphrases arrive over the window's own IPC (never the web view) and are not kept after use.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { type ImportPlan, SyncFileError, SyncFileFlowError, exportSyncFile, planImport, runImport, summarizeExport } from '@notespark/sync-protocol';
import * as database from '../../../mobile/src/storage/database';
import { addProfile, getActiveProfile, switchProfile } from '../../../mobile/src/storage/profiles';
import { storageStore } from '../../../mobile/src/storage/syncStore';

export interface FileDialogs {
  save(suggestedName: string): Promise<string | null>;
  open(): Promise<string | null>;
}

const sha256 = (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());

// Errors cross the IPC boundary as text; the window maps `SYNC_FILE:<reason>` to a sentence.
const fail = (e: unknown): never => {
  if (e instanceof SyncFileError) throw new Error(`SYNC_FILE:${e.reason}`);
  if (e instanceof SyncFileFlowError && e.reason === 'locked') throw new Error('SYNC_FILE:locked');
  if (e instanceof Error && /^SYNC_FILE:/.test(e.message)) throw e;
  throw new Error('SYNC_FILE:format');
};

export class SyncFileOps {
  private bytes: Uint8Array | null = null;
  private plan: Exclude<ImportPlan, { kind: 'otherProfile' }> | null = null;
  private pass = '';
  private fileName = '';
  constructor(private d: FileDialogs, private ready: () => boolean) {}

  private async store() {
    if (!this.ready()) throw new Error('PROFILE_LOCKED');
    const p = await getActiveProfile();
    return { store: storageStore(database.db, p.name, p.id), name: p.name };
  }

  clear() { this.bytes = null; this.plan = null; this.pass = ''; this.fileName = ''; }

  async call(op: string, a: any): Promise<unknown> {
    switch (op) {
      case 'summary': return summarizeExport((await this.store()).store);
      case 'export': {
        const { store, name } = await this.store();
        const file = await exportSyncFile({ store, name, passphrase: String(a?.passphrase ?? ''), uuid: randomUUID, attachments: a?.attachments !== false }).catch(fail);
        const path = await this.d.save(`notespark-sync-${new Date().toISOString().slice(0, 10)}.nsync`);
        if (!path) return false;
        await writeFile(path, file, { mode: 0o600 });
        return true;
      }
      case 'pick': {
        const path = await this.d.open();
        if (!path) return false;
        this.clear();
        this.bytes = new Uint8Array(await readFile(path).catch(() => fail(new Error('SYNC_FILE:format'))));
        return true;
      }
      case 'plan': {
        if (!this.bytes) return fail(new Error('SYNC_FILE:format'));
        const found = await planImport((await this.store()).store, this.bytes, String(a?.passphrase ?? ''), sha256).catch(fail);
        this.pass = String(a?.passphrase ?? '');
        if (found.kind === 'otherProfile') { this.fileName = found.fileName; this.plan = null; return { kind: 'otherProfile', fileNotes: 0, localNotes: 0, same: 0, attachments: 0, fileName: found.fileName }; }
        this.plan = found;
        return { kind: found.kind, fileNotes: found.fileNotes, localNotes: found.localNotes, same: found.pairs.length, attachments: found.attachments, fileName: found.content.name };
      }
      case 'run': {
        if (!this.bytes) return fail(new Error('SYNC_FILE:format'));
        try {
          let target = (await this.store()).store;
          let found = this.plan;
          if (a?.asNewProfile === true) {
            const created = await addProfile(this.fileName || 'Imported');
            await switchProfile(created.id);
            target = (await this.store()).store;
            const again = await planImport(target, this.bytes, this.pass, sha256);
            found = again.kind === 'otherProfile' ? null : again;
          }
          if (!found) return fail(new Error('SYNC_FILE:format'));
          await runImport(target, found);
        } catch (e) { fail(e); }
        return null;
      }
      case 'clear': this.clear(); return null;
      default: throw new Error(`Unknown sync file operation: ${op}`);
    }
  }
}
