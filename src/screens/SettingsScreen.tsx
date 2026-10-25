import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, IconButton, List, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { deleteAllNotesForever, moveAllNotesToBin, restoreBatch } from '../storage/notes';
import { addProfile, deleteProfileForever, eraseForgottenProfile, getActiveProfile, getBinnedProfiles, getDefaultProfile, getProfiles, hasProfilePin, moveProfileToBin, Profile, renameProfile, restoreProfile, setDefaultProfile, setProfilePin, setUsesBiometrics, switchProfile, unlockWithBiometrics, usesBiometrics, canUseBiometrics, verifyProfilePin, wrongPinMessage } from '../storage/profiles';
import { BIN_DAYS } from '../storage/database';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Snackbar from '../components/Snackbar';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const profileTimeLeft = (deletedAt: string) => {
  const days = BIN_DAYS - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000);
  if (days <= 0) return 'Erased the next time the app opens';
  if (days === 1) return 'Erased tomorrow';
  return `Erased in ${days} days`;
};

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { theme, themeType, setThemeType } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [binnedProfiles, setBinnedProfiles] = useState<Profile[]>([]);
  const [deleteMode, setDeleteMode] = useState<'bin' | 'forever'>('bin');
  const [snackbar, setSnackbar] = useState('');
  const [undoBatch, setUndoBatch] = useState<string | null>(null);
  const [activeId, setActiveId] = useState('');
  const [defaultId, setDefaultId] = useState('');
  const [protectedProfileIds, setProtectedProfileIds] = useState<string[]>([]);
  // Kept after closing so the text doesn't change while the dialog fades out.
  const [nameDialog, setNameDialog] = useState<{ editing: Profile | null; name: string; pin: string; pinConfirmation: string; open: boolean } | null>(null);
  // `fingerprint`: the dialog's "Also unlock with fingerprint" switch (manage mode).
  const [pinDialog, setPinDialog] = useState<{ profile: Profile; pin: string; pinConfirmation: string; currentPin: string; fingerprint: boolean; mode: 'unlock' | 'manage' | 'makeDefault' | 'delete'; open: boolean } | null>(null);
  const [fingerprintReady, setFingerprintReady] = useState(false);
  const openPinDialog = async (profile: Profile, mode: 'unlock' | 'manage' | 'makeDefault' | 'delete') => {
    const fingerprint = mode === 'manage' && (await usesBiometrics(profile.id).catch(() => false));
    if (mode === 'manage') setFingerprintReady(await canUseBiometrics().catch(() => false));
    setPinDialog({ profile, pin: '', pinConfirmation: '', currentPin: '', fingerprint, mode, open: true });
  };
  const closeNameDialog = () => setNameDialog(d => d && { ...d, open: false });
  const closePinDialog = () => setPinDialog(d => d && { ...d, open: false });

  const loadProfiles = useCallback(async () => {
    const [list, active, binned] = await Promise.all([getProfiles(), getActiveProfile(), getBinnedProfiles()]);
    const defaultProfile = await getDefaultProfile();
    setProfiles(list);
    setBinnedProfiles(binned);
    setActiveId(active.id);
    setDefaultId(defaultProfile.id);
    setProtectedProfileIds((await Promise.all(list.map(async profile => (await hasProfilePin(profile.id)) ? profile.id : null))).filter((id): id is string => id !== null));
  }, []);

  useFocusEffect(useCallback(() => { loadProfiles().catch(() => {}); }, [loadProfiles]));

  const activeName = profiles.find(p => p.id === activeId)?.name ?? '';

  const handleSaveName = async () => {
    if (!nameDialog) return;
    const name = nameDialog.name.trim();
    if (!name) return;
    try {
      if (nameDialog.editing) await renameProfile(nameDialog.editing.id, name);
      else {
        if ((nameDialog.pin || nameDialog.pinConfirmation) && (nameDialog.pin !== nameDialog.pinConfirmation || !/^\d{4}$/.test(nameDialog.pin))) return;
        await addProfile(name, nameDialog.pin || undefined);
      }
      closeNameDialog();
      await loadProfiles();
    } catch (error) {
      alert(nameDialog.editing ? "Couldn't rename the profile" : "Couldn't add the profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const confirmMakeDefault = (profile: Profile) => {
    if (profile.id === defaultId) return;
    alert(
      'Change default profile?',
      `NoteSpark will open ${profile.name} when it starts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make default', onPress: () => handleMakeDefault(profile) },
      ]
    );
  };

  const handleMakeDefault = async (profile: Profile, pin?: string) => {
    try {
      // Protected: fingerprint first if it's on for this profile, otherwise the PIN dialog.
      if (pin === undefined && !(await verifyProfilePin(profile.id, '')) && !(await unlockWithBiometrics(profile))) {
        openPinDialog(profile, 'makeDefault');
        return;
      }
      if (pin !== undefined && !(await verifyProfilePin(profile.id, pin))) {
        alert('Incorrect PIN', await wrongPinMessage(profile.id));
        return;
      }
      await setDefaultProfile(profile.id, pin ?? '');
      await loadProfiles();
      closePinDialog();
      setSnackbar(`${profile.name} is now the default profile`);
    } catch (error) {
      alert("Couldn't set the default profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const isProtected = (profile: Profile) => protectedProfileIds.includes(profile.id);

  // Changing or removing a PIN needs the current one.
  const checkCurrentPin = async (profile: Profile, currentPin: string) => {
    if (await verifyProfilePin(profile.id, currentPin)) return true;
    alert('Incorrect PIN', await wrongPinMessage(profile.id));
    return false;
  };

  // Setting a PIN needs a new one; changing needs the current one, and the new one is optional, so the
  // fingerprint switch can be changed on its own.
  const handleSavePin = async () => {
    if (!pinDialog || pinDialog.mode !== 'manage') return;
    const { profile, pin, pinConfirmation, currentPin, fingerprint } = pinDialog;
    const changing = isProtected(profile);
    if ((pin || !changing) && (pin.length !== 4 || pin !== pinConfirmation)) return;
    try {
      if (!(await checkCurrentPin(profile, currentPin))) return;
      if (pin) await setProfilePin(profile.id, pin, currentPin);
      await setUsesBiometrics(profile.id, fingerprint && fingerprintReady);
      closePinDialog();
      await loadProfiles();
      setSnackbar(pin ? `PIN set for ${profile.name}` : `Fingerprint unlock ${fingerprint ? 'on' : 'off'} for ${profile.name}`);
    } catch (error) {
      alert("Couldn't save the PIN", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleRemovePin = async () => {
    if (!pinDialog || pinDialog.mode !== 'manage') return;
    const { profile, currentPin } = pinDialog;
    if (!(await checkCurrentPin(profile, currentPin))) return;
    alert(
      'Remove profile PIN?',
      `${profile.name} will no longer ask for a PIN.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove PIN',
          style: 'destructive',
          onPress: async () => {
            try {
              await setProfilePin(profile.id, null, currentPin);
              closePinDialog();
              await loadProfiles();
              setSnackbar(`PIN removed from ${profile.name}`);
            } catch (error) {
              alert("Couldn't remove the PIN", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  // A PIN can't be recovered, so a forgotten one means erasing the profile. Never offered for the open profile.
  const handleForgotPin = (profile: Profile) => {
    closePinDialog();
    alert(
      'Erase this profile?',
      `A forgotten PIN can't be recovered. ${profile.name} and all its notes will be erased from this device. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase profile',
          style: 'destructive',
          onPress: async () => {
            try {
              await eraseForgottenProfile(profile.id);
              await loadProfiles();
              setSnackbar(`${profile.name} erased`);
            } catch (error) {
              alert("Couldn't erase the profile", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleSwitch = async (profile: Profile, pin?: string) => {
    if (profile.id === activeId) return;
    try {
      if (pin === undefined && !(await verifyProfilePin(profile.id, '')) && !(await unlockWithBiometrics(profile))) {
        openPinDialog(profile, 'unlock');
        return;
      }
      const enteredPin = pin ?? '';
      if (pin !== undefined && !(await verifyProfilePin(profile.id, enteredPin))) {
        alert('Incorrect PIN', await wrongPinMessage(profile.id));
        return;
      }
      closePinDialog();
      await switchProfile(profile.id, enteredPin);
      await loadProfiles();
    } catch (error) {
      alert("Couldn't switch profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleDeleteProfile = async (profile: Profile, pin?: string) => {
    if (pin === undefined && isProtected(profile) && !(await unlockWithBiometrics(profile))) {
      openPinDialog(profile, 'delete');
      return;
    }
    if (pin !== undefined && !(await verifyProfilePin(profile.id, pin))) {
      alert('Incorrect PIN', await wrongPinMessage(profile.id));
      return;
    }
    closePinDialog();
    alert(
      'Delete profile?',
      `${profile.name} and its notes move to the bin. You can restore it from Settings for ${BIN_DAYS} days.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete profile',
          style: 'destructive',
          onPress: async () => {
            try {
              await moveProfileToBin(profile.id, pin);
              await loadProfiles();
              setSnackbar('Profile deleted');
            } catch (error) {
              alert("Couldn't delete the profile", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleRestoreProfile = async (profile: Profile) => {
    try {
      await restoreProfile(profile.id);
      await loadProfiles();
      setSnackbar('Profile restored');
    } catch (error) {
      alert("Couldn't restore the profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleDeleteProfileForever = (profile: Profile) => {
    alert(
      'Delete profile forever?',
      `${profile.name} and all its notes are erased now. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProfileForever(profile.id);
              await loadProfiles();
              setSnackbar('Profile deleted forever');
            } catch (error) {
              alert("Couldn't delete the profile", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleMoveAllToBin = () => {
    alert(
      'Move all notes to bin?',
      `Every note in the ${activeName} profile moves to the bin. You can restore them from Bin for 30 days.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move all to bin',
          style: 'destructive',
          onPress: async () => {
            try {
              setUndoBatch(await moveAllNotesToBin());
              setSnackbar('All notes moved to bin');
            } catch (error) {
              alert("Couldn't move your notes to the bin", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllForever = () => {
    alert(
      'Delete all notes forever?',
      `Every note in the ${activeName} profile is erased now, without going to the bin. Notes already in the bin stay there. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAllNotesForever();
              setUndoBatch(null);
              setSnackbar('All notes deleted forever');
            } catch (error) {
              alert("Couldn't delete your notes", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleUndoMoveAll = async () => {
    if (!undoBatch) return;
    try {
      await restoreBatch(undoBatch);
    } catch (error) {
      alert("Couldn't restore your notes", 'Open Bin to restore them.');
    }
  };

  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 4);
  const changingPin = pinDialog?.mode === 'manage' && isProtected(pinDialog.profile);
  const pinName = pinDialog?.profile.name ?? '';
  const { pinTitle, pinMessage, pinAction } = {
    unlock: { pinTitle: 'Enter profile PIN', pinMessage: `Enter the four-digit PIN for ${pinName}.`, pinAction: 'Unlock' },
    makeDefault: { pinTitle: 'Enter PIN to make default', pinMessage: `Enter the four-digit PIN for ${pinName} to make it the default profile.`, pinAction: 'Make default' },
    delete: { pinTitle: 'Enter PIN to delete', pinMessage: `Enter the four-digit PIN for ${pinName} to delete it.`, pinAction: 'Delete profile' },
    manage: changingPin
      ? { pinTitle: 'Profile lock', pinMessage: `Enter the current PIN for ${pinName}. Leave the new PIN empty to keep it.`, pinAction: 'Save' }
      : { pinTitle: 'Set profile PIN', pinMessage: `${pinName} will ask for this PIN when you open it.`, pinAction: 'Save PIN' },
  }[pinDialog?.mode ?? 'unlock'];
  const submitPin = () => {
    if (!pinDialog) return;
    const { profile, pin, mode } = pinDialog;
    if (mode === 'manage') handleSavePin();
    else if (mode === 'makeDefault') handleMakeDefault(profile, pin);
    else if (mode === 'delete') handleDeleteProfile(profile, pin);
    else handleSwitch(profile, pin);
  };

  const chevron = <List.Icon icon="chevron-right" color={theme.colors.onSurfaceVariant} />;
  const sectionTitle = (title: string) => (
    <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.primary }]}>{title}</Text>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated}
        title="Settings"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.column}>
          {sectionTitle('Appearance')}
          <SegmentedButtons theme={controlTheme}
            value={themeType}
            onValueChange={value => setThemeType(value as 'light' | 'dark' | 'system')}
            buttons={[
              { value: 'light', label: 'Light', icon: 'white-balance-sunny' },
              { value: 'dark', label: 'Dark', icon: 'weather-night' },
              { value: 'system', label: 'System', icon: 'theme-light-dark' },
            ]}
          />

          {sectionTitle('Profiles')}
          {profiles.map((p, i) => (
            <GroupedRow
              key={p.id}
              title={p.name}
              description={p.id === activeId ? 'Current profile' : 'Tap to switch to this profile'}
              icon={p.id === activeId ? 'account-check' : 'account-outline'}
              onPress={() => handleSwitch(p)}
              right={
                <View style={styles.rowActions}>
                  <IconButton
                    icon="pencil-outline"
                    accessibilityLabel={`Rename ${p.name}`}
                    onPress={() => setNameDialog({ editing: p, name: p.name, pin: '', pinConfirmation: '', open: true })}
                  />
                  <IconButton
                    icon={protectedProfileIds.includes(p.id) ? 'lock-outline' : 'lock-open-outline'}
                    accessibilityLabel={protectedProfileIds.includes(p.id) ? `Change PIN or fingerprint unlock for ${p.name}` : `Set PIN for ${p.name}`}
                    onPress={() => openPinDialog(p, 'manage')}
                  />
                  <IconButton
                    icon={p.id === defaultId ? 'star' : 'star-outline'}
                    iconColor={p.id === defaultId ? theme.colors.primary : theme.colors.onSurfaceVariant}
                    accessibilityLabel={p.id === defaultId ? `${p.name} is the default profile` : `Make ${p.name} the default profile`}
                    onPress={() => confirmMakeDefault(p)}
                  />
                  {/* The default profile can't be deleted; make another profile the default first. */}
                  {p.id !== activeId && p.id !== defaultId && (
                    <IconButton
                      icon="delete-outline"
                      accessibilityLabel={`Delete ${p.name}`}
                      onPress={() => handleDeleteProfile(p)}
                    />
                  )}
                </View>
              }
              isFirst={i === 0}
              isLast={false}
            />
          ))}
          <GroupedRow
            title="Add profile"
            description="A separate set of notes, for work or school"
            icon="account-plus-outline"
            onPress={() => setNameDialog({ editing: null, name: '', pin: '', pinConfirmation: '', open: true })}
            isFirst={false}
            isLast
          />

          {binnedProfiles.length > 0 && sectionTitle('Deleted profiles')}
          {binnedProfiles.map((p, i) => (
            <GroupedRow
              key={p.id}
              title={p.name}
              description={profileTimeLeft(p.deletedAt!)}
              icon="account-remove-outline"
              right={
                <View style={styles.rowActions}>
                  <IconButton icon="restore" accessibilityLabel={`Restore ${p.name}`} onPress={() => handleRestoreProfile(p)} />
                  <IconButton icon="delete-forever-outline" accessibilityLabel={`Delete ${p.name} forever`} onPress={() => handleDeleteProfileForever(p)} />
                </View>
              }
              isFirst={i === 0}
              isLast={i === binnedProfiles.length - 1}
            />
          ))}

          {sectionTitle('Your notes')}
          <GroupedRow
            title="Import and export"
            description="Back up your notes or restore a backup"
            icon="swap-vertical"
            right={chevron}
            onPress={() => navigation.navigate('ImportExport')}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title="Bin"
            description="Restore deleted notes for 30 days"
            icon="delete-restore"
            right={chevron}
            onPress={() => navigation.navigate('Bin')}
            isFirst={false}
            isLast={false}
          />
          {/* The swap button flips this row between moving everything to the bin and erasing it without the bin. */}
          <GroupedRow
            title={deleteMode === 'bin' ? 'Move all notes to bin' : 'Delete all notes forever'}
            description={deleteMode === 'bin' ? 'Restorable from Bin for 30 days' : "Skips the bin. Can't be undone."}
            icon={deleteMode === 'bin' ? 'delete-sweep-outline' : 'delete-forever-outline'}
            danger
            onPress={deleteMode === 'bin' ? handleMoveAllToBin : handleDeleteAllForever}
            right={
              <IconButton
                icon="swap-horizontal"
                iconColor={theme.colors.onSurfaceVariant}
                accessibilityLabel={deleteMode === 'bin' ? 'Switch to delete all forever' : 'Switch to move all to bin'}
                onPress={() => setDeleteMode(m => (m === 'bin' ? 'forever' : 'bin'))}
              />
            }
            isFirst={false}
            isLast
          />

          {sectionTitle('App')}
          <GroupedRow
            title="About NoteSpark"
            description="Version, license and source code"
            icon="information-outline"
            right={chevron}
            onPress={() => navigation.navigate('About')}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title="Privacy policy"
            description="Your notes never leave your phone"
            icon="shield-lock-outline"
            right={chevron}
            onPress={() => navigation.navigate('Privacy')}
            isFirst={false}
            isLast
          />
        </View>
      </ScrollView>

      <Snackbar
        visible={!!snackbar}
        onDismiss={() => { setSnackbar(''); setUndoBatch(null); }}
        duration={5000}
        action={undoBatch ? { label: 'Undo', onPress: handleUndoMoveAll } : undefined}
      >
        {snackbar}
      </Snackbar>

      <KeyboardSafePortal>
        <Dialog visible={!!nameDialog?.open} onDismiss={closeNameDialog}>
          <Dialog.Title>{nameDialog?.editing ? 'Rename profile' : 'Add profile'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Profile name"
              value={nameDialog?.name ?? ''}
              onChangeText={name => setNameDialog(d => d && { ...d, name })}
              autoFocus
              onSubmitEditing={handleSaveName}
            />
            {!nameDialog?.editing && (
              <>
                <TextInput
                  mode="outlined"
                  label="Four-digit PIN (optional)"
                  value={nameDialog?.pin ?? ''}
                  onChangeText={pin => setNameDialog(d => d && { ...d, pin: pin.replace(/\D/g, '').slice(0, 4) })}
                  keyboardType="number-pad"
                  secureTextEntry
                  style={styles.dialogInput}
                />
                <TextInput
                  mode="outlined"
                  label="Confirm PIN"
                  value={nameDialog?.pinConfirmation ?? ''}
                  onChangeText={pinConfirmation => setNameDialog(d => d && { ...d, pinConfirmation: pinConfirmation.replace(/\D/g, '').slice(0, 4) })}
                  keyboardType="number-pad"
                  secureTextEntry
                  onSubmitEditing={handleSaveName}
                  style={styles.dialogInput}
                />
              </>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeNameDialog}>Cancel</Button>
            <Button onPress={handleSaveName} disabled={!nameDialog?.name.trim() || (!nameDialog?.editing && (!!nameDialog?.pin || !!nameDialog?.pinConfirmation) && ((nameDialog.pin?.length ?? 0) !== 4 || nameDialog.pin !== nameDialog.pinConfirmation))}>
              {nameDialog?.editing ? 'Rename' : 'Add profile'}
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!pinDialog?.open} onDismiss={closePinDialog}>
          <Dialog.Title>{pinTitle}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{pinMessage}</Text>
            {changingPin && (
              <TextInput
                mode="outlined"
                label="Current PIN"
                value={pinDialog.currentPin}
                onChangeText={currentPin => setPinDialog(d => d && { ...d, currentPin: digits(currentPin) })}
                keyboardType="number-pad"
                secureTextEntry
                autoFocus
                style={styles.dialogInput}
              />
            )}
            <TextInput
              mode="outlined"
              label={changingPin ? 'New PIN (optional)' : 'PIN'}
              value={pinDialog?.pin ?? ''}
              onChangeText={pin => setPinDialog(d => d && { ...d, pin: digits(pin) })}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus={!changingPin}
              onSubmitEditing={submitPin}
              style={styles.dialogInput}
            />
            {pinDialog?.mode === 'manage' && (
              <TextInput
                mode="outlined"
                label={changingPin ? 'Confirm new PIN' : 'Confirm PIN'}
                value={pinDialog.pinConfirmation}
                onChangeText={pinConfirmation => setPinDialog(d => d && { ...d, pinConfirmation: digits(pinConfirmation) })}
                keyboardType="number-pad"
                secureTextEntry
                onSubmitEditing={handleSavePin}
                style={styles.dialogInput}
              />
            )}
            {pinDialog?.mode === 'manage' && (
              <View style={styles.fingerprintRow}>
                <View style={styles.fingerprintText}>
                  <Text variant="bodyLarge" style={{ color: fingerprintReady ? theme.colors.onSurface : theme.colors.onSurfaceVariant }}>
                    Also unlock with fingerprint
                  </Text>
                  {!fingerprintReady && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      Set up a fingerprint in your phone's settings to use this.
                    </Text>
                  )}
                </View>
                <Switch
                  value={pinDialog.fingerprint && fingerprintReady}
                  disabled={!fingerprintReady}
                  onValueChange={fingerprint => setPinDialog(d => d && { ...d, fingerprint })}
                  accessibilityLabel="Also unlock with fingerprint"
                />
              </View>
            )}
            {pinDialog && isProtected(pinDialog.profile) && pinDialog.profile.id !== activeId && (
              <Button onPress={() => handleForgotPin(pinDialog.profile)} style={styles.forgotPin}>Forgot PIN?</Button>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            {changingPin && <Button onPress={handleRemovePin} disabled={pinDialog.currentPin.length !== 4} textColor={theme.colors.error}>Remove PIN</Button>}
            <Button onPress={closePinDialog}>Cancel</Button>
            <Button
              onPress={submitPin}
              disabled={
                !pinDialog ||
                (changingPin
                  ? pinDialog.currentPin.length !== 4 || (!!(pinDialog.pin || pinDialog.pinConfirmation) && (pinDialog.pin.length !== 4 || pinDialog.pin !== pinDialog.pinConfirmation))
                  : pinDialog.pin.length !== 4 || (pinDialog.mode === 'manage' && pinDialog.pin !== pinDialog.pinConfirmation))
              }
            >
              {pinAction}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </KeyboardSafePortal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dialogInput: {
    marginTop: space.md,
  },
  fingerprintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    minHeight: 48,
  },
  fingerprintText: {
    flex: 1,
  },
  forgotPin: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
  },
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
});

export default SettingsScreen;
