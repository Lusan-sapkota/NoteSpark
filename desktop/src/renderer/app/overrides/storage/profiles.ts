// Stands in for Mobile/src/storage/profiles.ts in the desktop renderer: the real module runs in the main process.
import type * as Real from '../../../../../../Mobile/src/storage/profiles';
import { storageProxy } from '../../bridge';

export const {
  getProfiles, getBinnedProfiles, getActiveProfile, getDefaultProfile, setDefaultProfile, getAutoLockMinutes, setAutoLockMinutes,
  getPinLockout, wrongPinMessage, verifyProfilePin, usesBiometrics, setUsesBiometrics, canUseBiometrics, unlockWithBiometrics,
  hasProfilePin, switchProfile, addProfile, syncProfileEncryption, setProfilePin, renameProfile, moveProfileToBin,
  restoreProfile, deleteProfileForever, purgeProfileBin, eraseForgottenProfile, readProfileNotes, transferNotesToProfile,
  getAllProfilesNoteContents,
} = storageProxy<typeof Real>('profiles', [
  'getProfiles', 'getBinnedProfiles', 'getActiveProfile', 'getDefaultProfile', 'setDefaultProfile', 'getAutoLockMinutes',
  'setAutoLockMinutes', 'getPinLockout', 'wrongPinMessage', 'verifyProfilePin', 'usesBiometrics', 'setUsesBiometrics',
  'canUseBiometrics', 'unlockWithBiometrics', 'hasProfilePin', 'switchProfile', 'addProfile', 'syncProfileEncryption',
  'setProfilePin', 'renameProfile', 'moveProfileToBin', 'restoreProfile', 'deleteProfileForever', 'purgeProfileBin',
  'eraseForgottenProfile', 'readProfileNotes', 'transferNotesToProfile', 'getAllProfilesNoteContents',
] as const);

export const AUTO_LOCK_MINUTES = [0, 1, 5, 15]; // same values as the phone's module
export type { Profile } from '../../../../../../Mobile/src/storage/profiles';
