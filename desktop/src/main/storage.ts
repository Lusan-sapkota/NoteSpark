// The phone's storage code (mobile/src/storage) running in the main process; the renderer uses the 'storage' channel.
import { BrowserWindow } from 'electron';
import * as attachments from '../../../mobile/src/storage/attachments';
import * as autoBackup from '../../../mobile/src/storage/autoBackup';
import * as database from '../../../mobile/src/storage/database';
import * as notes from '../../../mobile/src/storage/notes';
import * as profiles from '../../../mobile/src/storage/profiles';
import * as semanticSearch from '../../../mobile/src/storage/semanticSearch';
import { idleMs, watchAway } from './activity';
import AsyncStorage from '@notespark/node-shims/async-storage';

const modules = { notes, profiles, database, autoBackup, semanticSearch, attachments } as Record<string, Record<string, unknown>>;
// Backups write into a folder chosen in a system dialog on this computer, so only the desktop window may change them.
const desktopOnly = new Set(['autoBackup']);

// What the unlock screen may ask while a profile is locked.
const whileLocked = new Set(['getProfiles', 'getBinnedProfiles', 'getActiveProfile', 'getDefaultProfile', 'getAutoLockMinutes', 'getPinLockout', 'wrongPinMessage', 'hasProfilePin', 'usesBiometrics', 'canUseBiometrics', 'unlockWithBiometrics']);
// Profile calls a browser may make; switching, PINs, locking and deleting stay on the desktop.
const webProfiles = new Set(['getProfiles', 'getBinnedProfiles', 'getActiveProfile', 'getDefaultProfile', 'getAutoLockMinutes', 'getPinLockout', 'wrongPinMessage', 'hasProfilePin', 'usesBiometrics', 'canUseBiometrics']);

type Phase = 'starting' | 'ready' | 'locked' | 'unreadable';
let phase: Phase = 'starting';
let phaseProfile: profiles.Profile | null = null;
let starting: Promise<void> | undefined;

const announce = () => { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('lock:changed')); profilesChanged?.(); };
// Sync reads the lock state: it is told after every change (a lock, an unlock, a profile call).
let profilesChanged: (() => void) | null = null;
export const onProfilesChanged = (fn: () => void) => { profilesChanged = fn; };
export const isReady = () => phase === 'ready';

// What App.tsx does at start: convert profiles that have a PIN, open the default profile (or ask for its PIN).
const openDefault = async () => {
  const profile = await profiles.getDefaultProfile();
  if (await profiles.hasProfilePin(profile.id)) {
    phase = 'locked';
    phaseProfile = profile;
    return;
  }
  try {
    await profiles.switchProfile(profile.id);
    phase = 'ready';
    phaseProfile = null;
  } catch (error) {
    console.error('Failed to open default profile:', error);
    phase = 'unreadable';
    phaseProfile = profile;
  }
};

const start = () =>
  (starting ??= (async () => {
    try {
      await profiles.syncProfileEncryption();
      await openDefault();
      await profiles.purgeProfileBin().catch(error => console.warn('Profile bin purge failed:', error));
      await attachments.clearAttachmentTempDir().catch(() => {});
      setTimeout(() => attachments.pruneAttachments().catch(() => {}), 10_000).unref?.();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      phase = 'unreadable';
      phaseProfile = await profiles.getDefaultProfile().catch(() => ({ id: 'default', name: 'Personal' }));
    }
    // A due backup runs once the notes open, and again every hour while the app sits in the tray.
    autoBackup.runAutoBackupIfDue().catch(() => {});
    setInterval(() => autoBackup.runAutoBackupIfDue().catch(() => {}), 3_600_000).unref();
    // A protected profile asks for its PIN again after the app has been unused for the chosen time.
    watchAway(async () => {
      if (phase !== 'ready') return;
      try {
        const active = await profiles.getActiveProfile();
        if ((await profiles.hasProfilePin(active.id)) && idleMs() >= (await profiles.getAutoLockMinutes()) * 60_000) {
          phase = 'locked';
          phaseProfile = active;
          announce();
        }
      } catch {}
    });
  })());

// Whether the search model and the vector index can be used here (the phone's own check).
export const searchAvailable = () => semanticSearch.isMeaningSearchAvailable();

export const lockStatus = async () => {
  await start();
  return { phase, profile: phaseProfile && { id: phaseProfile.id, name: phaseProfile.name } };
};

// Desktop window only: the PIN is checked here, never over HTTP.
export const unlock = async ({ pin }: { pin: unknown }) => {
  await start();
  if (phase !== 'locked' || !phaseProfile || typeof pin !== 'string') return false;
  try {
    await profiles.switchProfile(phaseProfile.id, pin);
  } catch {
    return false;
  }
  phase = 'ready';
  phaseProfile = null;
  profilesChanged?.();
  return true;
};

export const eraseLocked = async () => {
  await start();
  if (!phaseProfile || phase === 'ready') throw new Error('Nothing to erase');
  await profiles.eraseForgottenProfile(phaseProfile.id);
  await openDefault();
};

export const retryOpen = async () => {
  await start();
  if (phase === 'unreadable') await openDefault();
};

// Delays Home's index update so the model process isn't started early and repeat asks merge; 0 runs at once (tests).
const SYNC_DELAY_MS = Number(process.env.NOTESPARK_SYNC_DELAY_MS ?? 15_000);
let syncTimer: NodeJS.Timeout | undefined;

export const callStorage = async ({ module, fn, args }: { module: string; fn: string; args?: unknown[] }, from: 'ipc' | 'http') => {
  if (desktopOnly.has(module) && from !== 'ipc') throw new Error(`Unknown storage call: ${module}.${fn}`);
  const exported = Object.hasOwn(modules, module) ? modules[module] : undefined;
  const target = exported && Object.hasOwn(exported, fn) ? exported[fn] : undefined;
  if (typeof target !== 'function') throw new Error(`Unknown storage call: ${module}.${fn}`);
  await start();
  if (module === 'semanticSearch' && fn === 'syncSearchIndex' && phase === 'ready' && SYNC_DELAY_MS > 0) {
    clearTimeout(syncTimer);
    // Only while the window is open: nobody is searching otherwise, and the next time Home opens it asks again.
    syncTimer = setTimeout(() => { if (phase === 'ready' && BrowserWindow.getAllWindows().length > 0) semanticSearch.syncSearchIndex().catch(() => {}); }, SYNC_DELAY_MS);
    syncTimer.unref();
    return;
  }
  if (phase !== 'ready' && !(module === 'profiles' && whileLocked.has(fn))) throw new Error(phase === 'unreadable' ? 'PROFILE_UNREADABLE' : 'PROFILE_LOCKED');
  if (from === 'http' && module === 'profiles' && !webProfiles.has(fn)) throw new Error('Profiles are managed in the desktop window');
  const result = await target(...(Array.isArray(args) ? args : []));
  if (module === 'profiles') profilesChanged?.(); // switching, locking, a PIN or a deletion can change which profiles the hub may use
  return result;
};

// The renderer's AsyncStorage: the same settings file the storage code reads.
export const callSettings = async ({ op, key, value }: { op: 'get' | 'set' | 'remove'; key: string; value?: string }) => {
  // PIN hashes, attempt counters and wrapped keys live in settings too; the settings channel is for everything else.
  if (typeof key !== 'string' || /pin|key|secret|token|backup/i.test(key)) throw new Error('Bad key');
  if (op === 'get') return AsyncStorage.getItem(key);
  if (op === 'set') return AsyncStorage.setItem(key, String(value));
  if (op === 'remove') return AsyncStorage.removeItem(key);
  throw new Error('Bad operation');
};
