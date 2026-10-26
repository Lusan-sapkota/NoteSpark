// The few file calls storage/database.ts makes (moving and deleting database files).
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = (uri: string) => (uri.startsWith('file://') ? fileURLToPath(uri) : uri);
export const getInfoAsync = async (uri: string) => ({ exists: existsSync(path(uri)) });
export const deleteAsync = async (uri: string, _options?: { idempotent?: boolean }) => rmSync(path(uri), { force: true });
export const moveAsync = async ({ from, to }: { from: string; to: string }) => renameSync(path(from), path(to));
export const writeAsStringAsync = async (uri: string, text: string) => writeFileSync(path(uri), text);
// Backups to a chosen folder are a later phase.
export const StorageAccessFramework = {};
