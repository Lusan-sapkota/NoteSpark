import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { t } from '@notespark/core';

// Writes the sync file to the app cache (no permission needed), then the share sheet saves or sends it.
export const shareSyncFile = async (bytes: Uint8Array): Promise<void> => {
  const file = new File(Paths.cache, `notespark-sync-${Date.now()}.nsync`);
  await file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: t('sync.fileExport') });
};

export const readSyncFile = async (uri: string): Promise<Uint8Array> => {
  try {
    return await new File(uri).bytes();
  } catch {
    const data = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return Uint8Array.from(atob(data), c => c.charCodeAt(0));
  }
};
