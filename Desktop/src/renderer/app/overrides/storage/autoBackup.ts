// Stands in for Mobile/src/storage/autoBackup.ts in the desktop renderer: the real module runs in the main process,
// where "pick a folder" is the system folder dialog (desktop window only).
import type * as Real from '../../../../../../Mobile/src/storage/autoBackup';
import { storageProxy } from '../../bridge';

export const { getAutoBackup, setAutoBackup, pickBackupFolder, runBackup, runAutoBackupIfDue } = storageProxy<typeof Real>('autoBackup', [
  'getAutoBackup', 'setAutoBackup', 'pickBackupFolder', 'runBackup', 'runAutoBackupIfDue',
] as const);

export const BACKUPS_KEPT = 5; // same value as the phone's module
// The folder's name for display; the desktop stores a plain path.
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? 'Backup folder';
export type { AutoBackupSettings } from '../../../../../../Mobile/src/storage/autoBackup';
