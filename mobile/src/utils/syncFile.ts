import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { SyncFileError, SyncFileFlowError, type ImportPlan, exportSyncFile, planImport, runImport, summarizeExport } from '@notespark/sync-protocol';
import { t } from '@notespark/core';
import * as database from '../storage/database';
import { addProfile, getActiveProfile, switchProfile } from '../storage/profiles';
import { storageStore } from '../storage/syncStore';
import { reconcileSync } from '../sync/syncRuntime';

// What the sync file screen (components/SyncFile.tsx) needs. The phone does it here; the desktop does it in its main process
// (desktop/src/renderer/app/overrides/utils/syncFile.ts), where the profile's storage and the file dialogs are.
export type FileProblem = 'passphrase' | 'format' | 'version' | 'tooBig' | 'locked';
export class SyncFileFailure extends Error {
  reason: FileProblem;
  constructor(reason: FileProblem) { super(reason); this.reason = reason; }
}
export interface PlanView { kind: 'merge' | 'adopt' | 'otherProfile'; fileNotes: number; localNotes: number; same: number; attachments: number; fileName: string }
export interface SyncFileBackend {
  available: boolean;
  summary(): Promise<{ notes: number; attachments: number; attachmentBytes: number }>;
  exportFile(passphrase: string, attachments: boolean): Promise<boolean>; // false: the person cancelled the save
  pickFile(): Promise<boolean>; // false: cancelled
  plan(passphrase: string): Promise<PlanView>; // changes nothing
  run(asNewProfile: boolean): Promise<void>;
  clear(): void;
}

// A failure the screen can word: anything else is "not a sync file".
export const asFailure = (e: unknown): SyncFileFailure => {
  if (e instanceof SyncFileFailure) return e;
  if (e instanceof SyncFileError) return new SyncFileFailure(e.reason);
  if (e instanceof SyncFileFlowError && e.reason === 'locked') return new SyncFileFailure('locked');
  return new SyncFileFailure('format');
};

const readBytes = async (uri: string): Promise<Uint8Array> => {
  try {
    return await new File(uri).bytes();
  } catch {
    const data = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return Uint8Array.from(atob(data), c => c.charCodeAt(0));
  }
};

// Writes the sync file to the app cache (no permission needed), then the share sheet saves or sends it.
const share = async (bytes: Uint8Array): Promise<void> => {
  const file = new File(Paths.cache, `notespark-sync-${Date.now()}.nsync`);
  await file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: t('sync.fileExport') });
};

const openStore = async () => {
  const p = await getActiveProfile();
  return { store: storageStore(database.db, p.name, p.id), name: p.name };
};

let bytes: Uint8Array | null = null;
let plan: Exclude<ImportPlan, { kind: 'otherProfile' }> | null = null;
let otherName = '';
let pass = '';

export const syncFileBackend: SyncFileBackend = {
  available: true,
  summary: async () => summarizeExport((await openStore()).store),
  exportFile: async (passphrase, attachments) => {
    const { store, name } = await openStore();
    const file = await exportSyncFile({ store, name, passphrase, uuid: randomUUID, attachments }).catch(e => { throw asFailure(e); });
    await share(file);
    return true;
  },
  pickFile: async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
    if (result.canceled || !result.assets?.[0]) return false;
    bytes = await readBytes(result.assets[0].uri).catch(() => { throw new SyncFileFailure('format'); });
    return true;
  },
  plan: async passphrase => {
    if (!bytes) throw new SyncFileFailure('format');
    const found = await planImport((await openStore()).store, bytes, passphrase, sha256).catch(e => { throw asFailure(e); });
    pass = passphrase;
    if (found.kind === 'otherProfile') { otherName = found.fileName; plan = null; return { kind: 'otherProfile', fileNotes: 0, localNotes: 0, same: 0, attachments: 0, fileName: found.fileName }; }
    plan = found;
    return { kind: found.kind, fileNotes: found.fileNotes, localNotes: found.localNotes, same: found.pairs.length, attachments: found.attachments, fileName: found.content.name };
  },
  run: async asNewProfile => {
    if (!bytes) throw new SyncFileFailure('format');
    try {
      let target = (await openStore()).store;
      let found = plan;
      if (asNewProfile) { // a new, empty profile: the file's notes join it and nothing else is touched
        const created = await addProfile(otherName || t('sync.fileImport'));
        await switchProfile(created.id);
        target = (await openStore()).store;
        const again = await planImport(target, bytes, pass, sha256);
        found = again.kind === 'otherProfile' ? null : again;
      }
      if (!found) throw new SyncFileFailure('format');
      await runImport(target, found);
      void reconcileSync();
    } catch (e) { throw asFailure(e); }
  },
  clear: () => { bytes = null; plan = null; otherName = ''; pass = ''; },
};
