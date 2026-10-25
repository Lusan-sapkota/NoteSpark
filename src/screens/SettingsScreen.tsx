import React, { useCallback, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, IconButton, List, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { deleteAllNotesForever, moveAllNotesToBin, restoreBatch } from '../storage/notes';
import { addProfile, deleteProfile, getActiveProfile, getDefaultProfile, getProfiles, hasProfilePin, Profile, renameProfile, setDefaultProfile, setProfilePin, switchProfile, verifyProfilePin } from '../storage/profiles';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Snackbar from '../components/Snackbar';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { theme, themeType, setThemeType } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deleteMode, setDeleteMode] = useState<'bin' | 'forever'>('bin');
  const [snackbar, setSnackbar] = useState('');
  const [undoBatch, setUndoBatch] = useState<string | null>(null);
  const [activeId, setActiveId] = useState('');
  const [defaultId, setDefaultId] = useState('');
  const [protectedProfileIds, setProtectedProfileIds] = useState<string[]>([]);
  // Kept after closing so the text doesn't change while the dialog fades out.
  const [nameDialog, setNameDialog] = useState<{ editing: Profile | null; name: string; pin: string; pinConfirmation: string; open: boolean } | null>(null);
  const [pinDialog, setPinDialog] = useState<{ profile: Profile; pin: string; pinConfirmation: string; mode: 'unlock' | 'manage' | 'makeDefault'; open: boolean } | null>(null);
  const closeNameDialog = () => setNameDialog(d => d && { ...d, open: false });
  const closePinDialog = () => setPinDialog(d => d && { ...d, open: false });

  const loadProfiles = useCallback(async () => {
    const [list, active] = await Promise.all([getProfiles(), getActiveProfile()]);
    const defaultProfile = await getDefaultProfile();
    setProfiles(list);
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
      if (pin === undefined && !(await verifyProfilePin(profile.id, ''))) {
        setPinDialog({ profile, pin: '', pinConfirmation: '', mode: 'makeDefault', open: true });
        return;
      }
      await setDefaultProfile(profile.id, pin ?? '');
      await loadProfiles();
      closePinDialog();
      setSnackbar(`${profile.name} is now the default profile`);
    } catch (error) {
      alert("Couldn't set the default profile", 'Enter the correct PIN and try again.');
    }
  };

  const openPinManager = (profile: Profile) => {
    setPinDialog({ profile, pin: '', pinConfirmation: '', mode: 'manage', open: true });
  };

  const handleSavePin = async () => {
    if (!pinDialog || pinDialog.mode !== 'manage') return;
    if (pinDialog.pin.length !== 4 || pinDialog.pin !== pinDialog.pinConfirmation) return;
    try {
      await setProfilePin(pinDialog.profile.id, pinDialog.pin);
      closePinDialog();
      await loadProfiles();
      setSnackbar(`PIN set for ${pinDialog.profile.name}`);
    } catch (error) {
      alert("Couldn't save the PIN", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleResetPin = () => {
    if (!pinDialog || pinDialog.mode !== 'manage') return;
    const profile = pinDialog.profile;
    alert(
      'Reset profile PIN?',
      `${profile.name} will no longer require a PIN when you switch to it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset PIN',
          style: 'destructive',
          onPress: async () => {
            try {
              await setProfilePin(profile.id, null);
              closePinDialog();
              await loadProfiles();
              setSnackbar(`PIN reset for ${profile.name}`);
            } catch (error) {
              alert("Couldn't reset the PIN", 'Try again. If it keeps failing, restart the app.');
            }
          },
        },
      ]
    );
  };

  const handleSwitch = async (profile: Profile, pin?: string) => {
    if (profile.id === activeId) return;
    try {
      if (pin === undefined && !(await verifyProfilePin(profile.id, ''))) {
        setPinDialog({ profile, pin: '', pinConfirmation: '', mode: 'unlock', open: true });
        return;
      }
      const enteredPin = pin ?? '';
      if (!(await verifyProfilePin(profile.id, enteredPin))) {
        alert('Incorrect PIN', 'Enter the four-digit PIN for this profile.');
        return;
      }
      closePinDialog();
      await switchProfile(profile.id, enteredPin);
      await loadProfiles();
    } catch (error) {
      alert("Couldn't switch profile", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const handleDeleteProfile = (profile: Profile) => {
    alert(
      'Delete profile?',
      `"${profile.name}" and all its notes will be deleted from this device. This can't be undone. Switch to it and export its notes first if you want a backup.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete profile',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProfile(profile.id);
              await loadProfiles();
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
                    accessibilityLabel={protectedProfileIds.includes(p.id) ? `Change or reset PIN for ${p.name}` : `Set PIN for ${p.name}`}
                    onPress={() => openPinManager(p)}
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
          <Dialog.Title>{pinDialog?.mode === 'manage' ? (protectedProfileIds.includes(pinDialog.profile.id) ? 'Change profile PIN' : 'Set profile PIN') : pinDialog?.mode === 'makeDefault' ? 'Enter PIN to make default' : 'Enter profile PIN'}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {pinDialog?.mode === 'manage'
                ? 'A PIN is optional. Leave this dialog open to set or change it.'
                : pinDialog?.mode === 'makeDefault'
                ? `Enter the four-digit PIN for ${pinDialog.profile.name} to make it the default profile.`
                : `Enter the four-digit PIN for ${pinDialog?.profile.name}.`}
            </Text>
            <TextInput
              mode="outlined"
              label="PIN"
              value={pinDialog?.pin ?? ''}
              onChangeText={pin => setPinDialog(d => d && { ...d, pin: pin.replace(/\D/g, '').slice(0, 4) })}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              onSubmitEditing={() => pinDialog && (pinDialog.mode === 'manage' ? handleSavePin() : pinDialog.mode === 'makeDefault' ? handleMakeDefault(pinDialog.profile, pinDialog.pin) : handleSwitch(pinDialog.profile, pinDialog.pin))}
              style={styles.dialogInput}
            />
            {pinDialog?.mode === 'manage' && (
              <TextInput
                mode="outlined"
                label="Confirm PIN"
                value={pinDialog.pinConfirmation}
                onChangeText={pinConfirmation => setPinDialog(d => d && { ...d, pinConfirmation: pinConfirmation.replace(/\D/g, '').slice(0, 4) })}
                keyboardType="number-pad"
                secureTextEntry
                onSubmitEditing={handleSavePin}
                style={styles.dialogInput}
              />
            )}
          </Dialog.Content>
          <Dialog.Actions>
            {pinDialog?.mode === 'manage' && protectedProfileIds.includes(pinDialog.profile.id) && <Button onPress={handleResetPin} textColor={theme.colors.error}>Reset PIN</Button>}
            <Button onPress={closePinDialog}>Cancel</Button>
            {pinDialog?.mode === 'manage'
              ? <Button onPress={handleSavePin} disabled={pinDialog.pin.length !== 4 || pinDialog.pin !== pinDialog.pinConfirmation}>Save PIN</Button>
              : pinDialog?.mode === 'makeDefault'
              ? <Button onPress={() => pinDialog && handleMakeDefault(pinDialog.profile, pinDialog.pin)} disabled={pinDialog.pin.length !== 4}>Make default</Button>
              : <Button onPress={() => pinDialog && handleSwitch(pinDialog.profile, pinDialog.pin)} disabled={pinDialog?.pin.length !== 4}>Unlock</Button>}
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
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
});

export default SettingsScreen;
