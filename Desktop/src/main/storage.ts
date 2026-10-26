// The phone's own storage code (Mobile/src/storage), running here in the main process on the shims in ./shims.
// The renderer reaches it through the 'storage' channel; nothing is copied, so desktop and phone share the rules.
import * as database from '../../../Mobile/src/storage/database';
import * as notes from '../../../Mobile/src/storage/notes';
import * as profiles from '../../../Mobile/src/storage/profiles';
import AsyncStorage from './shims/async-storage';

const modules = { notes, profiles, database } as Record<string, Record<string, unknown>>;

// Opens the default profile the way App.tsx does at start. Protected profiles come with the profile screens (phase 4).
let ready: Promise<void> | undefined;
const ensureReady = () =>
  (ready ??= (async () => {
    const profile = await profiles.getDefaultProfile();
    if (await profiles.hasProfilePin(profile.id)) throw new Error('This profile is protected. Unlocking comes to the desktop app in a later step.');
    await profiles.switchProfile(profile.id);
    await profiles.purgeProfileBin().catch(error => console.warn('Profile bin purge failed:', error));
  })().catch(error => { ready = undefined; throw error; }));

export const callStorage = async ({ module, fn, args }: { module: string; fn: string; args?: unknown[] }) => {
  const exported = Object.hasOwn(modules, module) ? modules[module] : undefined;
  const target = exported && Object.hasOwn(exported, fn) ? exported[fn] : undefined;
  if (typeof target !== 'function') throw new Error(`Unknown storage call: ${module}.${fn}`);
  await ensureReady();
  return target(...(Array.isArray(args) ? args : []));
};

// The renderer's AsyncStorage: the same settings file the storage code reads.
export const callSettings = async ({ op, key, value }: { op: 'get' | 'set' | 'remove'; key: string; value?: string }) => {
  // PIN hashes and wrapped keys live in settings too; the settings channel is for everything else.
  if (typeof key !== 'string' || /pin|key|secret|token/i.test(key)) throw new Error('Bad key');
  if (op === 'get') return AsyncStorage.getItem(key);
  if (op === 'set') return AsyncStorage.setItem(key, String(value));
  if (op === 'remove') return AsyncStorage.removeItem(key);
  throw new Error('Bad operation');
};
