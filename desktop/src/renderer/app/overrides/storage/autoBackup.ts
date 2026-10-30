// Stands in for mobile/src/storage/autoBackup.ts; the real module runs in the main process.
import type * as Real from '../../../../../../mobile/src/storage/autoBackup';
import { t } from '@notespark/core';
import { storageProxy } from '../../bridge';

export const { getAutoBackup, setAutoBackup, pickBackupFolder, runBackup, runAutoBackupIfDue } = storageProxy<typeof Real>('autoBackup', [
  'getAutoBackup', 'setAutoBackup', 'pickBackupFolder', 'runBackup', 'runAutoBackupIfDue',
] as const);

export const BACKUPS_KEPT = 5; // same value as the phone's module
// The folder's name for display; the desktop stores a plain path.
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? t('settings.backupFolder');
export type { AutoBackupSettings } from '../../../../../../mobile/src/storage/autoBackup';
