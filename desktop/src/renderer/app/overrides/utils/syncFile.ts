// Stands in for mobile/src/utils/syncFile.ts in the desktop renderer: the work (the profile's storage and the file dialogs) is in the
// main process (src/main/syncFile.ts). Only the desktop window has it; the web view in a browser has no file dialogs.
import { invoke, isDesktop } from '../../bridge';
import type { FileProblem, PlanView, SyncFileBackend } from '../../../../../../mobile/src/utils/syncFile';

export type { FileProblem, PlanView, SyncFileBackend };
export class SyncFileFailure extends Error {
  reason: FileProblem;
  constructor(reason: FileProblem) { super(reason); this.reason = reason; }
}

export const asFailure = (e: unknown): SyncFileFailure => {
  if (e instanceof SyncFileFailure) return e;
  const m = /SYNC_FILE:(passphrase|format|version|tooBig|locked)/.exec(String((e as Error)?.message));
  return new SyncFileFailure((m?.[1] as FileProblem) ?? 'format');
};

const call = <T,>(op: string, args?: unknown) => invoke<T>('syncFile', { op, args }).catch(e => { throw asFailure(e); });

export const syncFileBackend: SyncFileBackend = {
  available: isDesktop,
  summary: () => call('summary'),
  exportFile: (passphrase, attachments) => call('export', { passphrase, attachments }),
  pickFile: () => call('pick'),
  plan: passphrase => call('plan', { passphrase }),
  run: asNewProfile => call('run', { asNewProfile }),
  clear: () => { void call('clear').catch(() => {}); },
};
