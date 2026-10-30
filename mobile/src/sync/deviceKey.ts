// This install's sync key pair. The private half lives only in expo-secure-store, which is left out of Android backups
// (`configureAndroidBackup: false`), so a restored phone has no key and pairs again (F2). Never logged, never in the database.
import './random';
import { type Keypair, generateKeypair, keypairFromPrivate } from '@notespark/sync-protocol';
import * as SecureStore from 'expo-secure-store';

const KEY = 'syncDeviceKey';
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], h => parseInt(h, 16));

export const deviceKey = async (): Promise<Keypair> => {
  const saved = await SecureStore.getItemAsync(KEY);
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return keypairFromPrivate(unhex(saved));
  const pair = generateKeypair();
  await SecureStore.setItemAsync(KEY, hex(pair.priv));
  return pair;
};
