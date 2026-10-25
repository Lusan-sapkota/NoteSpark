import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, Icon, IconButton, List, RadioButton, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import M3Switch from '../components/M3Switch';
import { RootStackParamList } from '../types';
import { deleteAllNotesForever, getShareTarget, moveAllNotesToBin, restoreBatch, setShareTarget, ShareTarget } from '../storage/notes';
import { isRediscoverOn, setRediscoverOn } from '../utils/rediscover';
import { formatHour, getReminderHour, REMINDER_HOURS, setReminderHour } from '../utils/taskReminders';
import { AUTO_LOCK_MINUTES, deleteProfileForever, eraseForgottenProfile, getActiveProfile, getAutoLockMinutes, setAutoLockMinutes, getBinnedProfiles, getDefaultProfile, getProfiles, hasProfilePin, moveProfileToBin, Profile, renameProfile, restoreProfile, setDefaultProfile, switchProfile, unlockWithBiometrics, usesBiometrics, verifyProfilePin, wrongPinMessage } from '../storage/profiles';
import { BIN_DAYS } from '../storage/database';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Menu from '../components/Menu';
import Snackbar from '../components/Snackbar';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, shape, space } from '../theme/theme';
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
  const route = useRoute<RouteProp<RootStackParamList, 'Settings'>>();
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
  const [fingerprintProfileIds, setFingerprintProfileIds] = useState<string[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reminderHour, setReminderHourState] = useState(9);
  const [autoLock, setAutoLock] = useState(1);
  const [rediscover, setRediscover] = useState(true);
  const [shareTarget, setShareTargetState] = useState<ShareTarget>('scratchpad');
  // A pick-one dialog (reminder time, auto-lock); kept after closing so it doesn't change while fading.
  const [choice, setChoice] = useState<{ title: string; options: { label: string; value: number }[]; value: number; onPick: (value: number) => void; open: boolean } | null>(null);
  // Kept after closing so the text doesn't change while the dialog fades out.
  const [nameDialog, setNameDialog] = useState<{ profile: Profile; name: string; open: boolean } | null>(null);
  const [pinDialog, setPinDialog] = useState<{ profile: Profile; pin: string; mode: 'unlock' | 'makeDefault' | 'delete'; open: boolean } | null>(null);
  const openPinDialog = (profile: Profile, mode: 'unlock' | 'makeDefault' | 'delete') => setPinDialog({ profile, pin: '', mode, open: true });
  const closeNameDialog = () => setNameDialog(d => d && { ...d, open: false });
  const closePinDialog = () => setPinDialog(d => d && { ...d, open: false });

  const loadProfiles = useCallback(async () => {
    const [list, active, binned] = await Promise.all([getProfiles(), getActiveProfile(), getBinnedProfiles()]);
    const defaultProfile = await getDefaultProfile();
    setProfiles(list);
    setBinnedProfiles(binned);
    setActiveId(active.id);
    setDefaultId(defaultProfile.id);
    const idsWhere = async (test: (id: string) => Promise<boolean>) =>
      (await Promise.all(list.map(async profile => ((await test(profile.id)) ? profile.id : null)))).filter((id): id is string => id !== null);
    setProtectedProfileIds(await idsWhere(hasProfilePin));
    setFingerprintProfileIds(await idsWhere(usesBiometrics));
    setReminderHourState(await getReminderHour());
    setAutoLock(await getAutoLockMinutes());
    setRediscover(await isRediscoverOn());
    setShareTargetState(await getShareTarget());
  }, []);

  const lockLabel = (minutes: number) => (minutes === 0 ? 'Right away' : `After ${minutes} minute${minutes === 1 ? '' : 's'}`);
  const pickReminderHour = () =>
    setChoice({
      title: 'Task reminders',
      options: REMINDER_HOURS.map(h => ({ label: formatHour(h), value: h })),
      value: reminderHour,
      onPick: hour => {
        setReminderHourState(hour);
        setReminderHour(hour).catch(() => alert("Couldn't update reminders", 'Try again. If it keeps failing, restart the app.'));
      },
      open: true,
    });
  const shareTargets: ShareTarget[] = ['scratchpad', 'note'];
  const shareLabel = (target: ShareTarget) => (target === 'scratchpad' ? 'Add to scratchpad' : 'Open a new note');
  const pickShareTarget = () =>
    setChoice({
      title: 'Text shared to NoteSpark',
      options: shareTargets.map((t, i) => ({ label: shareLabel(t), value: i })),
      value: shareTargets.indexOf(shareTarget),
      onPick: i => {
        setShareTargetState(shareTargets[i]);
        setShareTarget(shareTargets[i]).catch(() => {});
      },
      open: true,
    });
  const pickAutoLock = () =>
    setChoice({
      title: 'Lock again when away',
      options: AUTO_LOCK_MINUTES.map(m => ({ label: lockLabel(m), value: m })),
      value: autoLock,
      onPick: minutes => {
        setAutoLock(minutes);
        setAutoLockMinutes(minutes).catch(() => {});
      },
      open: true,
    });

  useFocusEffect(useCallback(() => { loadProfiles().catch(() => {}); }, [loadProfiles]));

  const message = route.params?.message;
  useEffect(() => {
    if (!message) return;
    setSnackbar(message);
    navigation.setParams({ message: undefined });
  }, [message]);

  const activeName = profiles.find(p => p.id === activeId)?.name ?? '';

  const handleRename = async () => {
    if (!nameDialog) return;
    const name = nameDialog.name.trim();
    if (!name) return;
    try {
      await renameProfile(nameDialog.profile.id, name);
      closeNameDialog();
      await loadProfiles();
    } catch (error) {
      alert("Couldn't rename the profile", 'Try again. If it keeps failing, restart the app.');
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
      alert(
        `Couldn't open ${profile.name}`,
        "This profile's database couldn't be read. If this phone was restored from a backup, a locked profile's encryption key isn't included in backups.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Erase profile', style: 'destructive', onPress: () => handleForgotPin(profile) },
        ]
      );
    }
  };

  const isProtected = (profile: Profile) => protectedProfileIds.includes(profile.id);

  // A PIN can't be recovered, so a forgotten one means erasing the profile.
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
      alert(
        `Couldn't open ${profile.name}`,
        "This profile's database couldn't be read. If this phone was restored from a backup, a locked profile's encryption key isn't included in backups.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Erase profile', style: 'destructive', onPress: () => handleForgotPin(profile) },
        ]
      );
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

  const pinName = pinDialog?.profile.name ?? '';
  const { pinTitle, pinMessage, pinAction } = {
    unlock: { pinTitle: 'Enter profile PIN', pinMessage: `Enter the four-digit PIN for ${pinName}.`, pinAction: 'Unlock' },
    makeDefault: { pinTitle: 'Enter PIN to make default', pinMessage: `Enter the four-digit PIN for ${pinName} to open it at start.`, pinAction: 'Open at start' },
    delete: { pinTitle: 'Enter PIN to delete', pinMessage: `Enter the four-digit PIN for ${pinName} to delete it.`, pinAction: 'Delete profile' },
  }[pinDialog?.mode ?? 'unlock'];
  const submitPin = () => {
    if (!pinDialog) return;
    const { profile, pin, mode } = pinDialog;
    if (mode === 'makeDefault') handleMakeDefault(profile, pin);
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

          {sectionTitle('Notes and tasks')}
          <GroupedRow
            title="Rediscover on Home"
            description="One older note a day at the top of your list"
            icon="history"
            right={
              <M3Switch
                value={rediscover}
                onValueChange={on => { setRediscover(on); setRediscoverOn(on).catch(() => {}); }}
                accessibilityLabel="Rediscover on Home"
              />
            }
            onPress={() => { setRediscover(!rediscover); setRediscoverOn(!rediscover).catch(() => {}); }}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title="Text shared to NoteSpark"
            description={shareLabel(shareTarget)}
            icon="share-variant-outline"
            right={chevron}
            onPress={pickShareTarget}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title="Task reminders"
            description={`${formatHour(reminderHour)} on the day a task is due`}
            icon="bell-outline"
            right={chevron}
            onPress={pickReminderHour}
            isFirst={false}
            isLast
          />

          {sectionTitle('Profiles')}
          {profiles.map((p, i) => {
            const current = p.id === activeId;
            const isDefault = p.id === defaultId;
            const lockIcon = fingerprintProfileIds.includes(p.id) ? 'fingerprint' : isProtected(p) ? 'lock-outline' : null;
            const status = current ? (isDefault ? 'Open now, and opens at start' : 'Open now') : isDefault ? 'Opens at start, tap to switch' : 'Tap to switch';
            return (
              <GroupedRow
                key={p.id}
                title={p.name}
                description={status}
                left={
                  <View style={[styles.avatar, { backgroundColor: current ? theme.colors.secondaryContainer : theme.colors.surfaceContainerHighest }]}>
                    <Text variant="titleMedium" style={{ color: current ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant }}>
                      {p.name.trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                }
                onPress={current ? undefined : () => handleSwitch(p)}
                right={
                  <View style={styles.rowActions}>
                    {lockIcon && (
                      <View accessible accessibilityLabel={lockIcon === 'fingerprint' ? 'Locked with fingerprint and PIN' : 'Locked with a PIN'}>
                        <Icon source={lockIcon} size={18} color={theme.colors.onSurfaceVariant} />
                      </View>
                    )}
                    <Menu
                      visible={menuFor === p.id}
                      onDismiss={() => setMenuFor(null)}
                      anchor={<IconButton icon="dots-vertical" accessibilityLabel={`Options for ${p.name}`} onPress={() => setMenuFor(p.id)} />}
                    >
                      {!current && (
                        <Menu.Item leadingIcon="swap-horizontal" title="Switch to this profile" onPress={() => { setMenuFor(null); handleSwitch(p); }} />
                      )}
                      <Menu.Item leadingIcon="pencil-outline" title="Rename" onPress={() => { setMenuFor(null); setNameDialog({ profile: p, name: p.name, open: true }); }} />
                      <Menu.Item leadingIcon="lock-outline" title="Lock" onPress={() => { setMenuFor(null); navigation.navigate('ProfileLock', { profileId: p.id }); }} />
                      {!isDefault && (
                        <Menu.Item leadingIcon="star-outline" title="Open at start" onPress={() => { setMenuFor(null); confirmMakeDefault(p); }} />
                      )}
                      {/* The open and default profiles can't be deleted. */}
                      {!current && !isDefault && (
                        <Menu.Item
                          leadingIcon="delete-outline"
                          title="Delete profile"
                          titleStyle={{ color: theme.colors.error }}
                          onPress={() => { setMenuFor(null); handleDeleteProfile(p); }}
                        />
                      )}
                    </Menu>
                  </View>
                }
                isFirst={i === 0}
                isLast={false}
              />
            );
          })}
          <GroupedRow
            title="Add profile"
            left={
              <View style={[styles.avatar, { borderWidth: 1, borderColor: theme.colors.outlineVariant }]}>
                <Icon source="plus" size={22} color={theme.colors.onSurfaceVariant} />
              </View>
            }
            onPress={() => navigation.navigate('ProfileLock')}
            isFirst={false}
            isLast={protectedProfileIds.length === 0}
          />
          {protectedProfileIds.length > 0 && (
            <GroupedRow
              title="Lock again when away"
              description={`${lockLabel(autoLock)} in the background, ask for the PIN`}
              icon="lock-clock"
              right={chevron}
              onPress={pickAutoLock}
              isFirst={false}
              isLast
            />
          )}

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

          {sectionTitle('Backup and storage')}
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
          <Dialog.Title>Rename profile</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Profile name"
              value={nameDialog?.name ?? ''}
              onChangeText={name => setNameDialog(d => d && { ...d, name })}
              autoFocus
              maxLength={40}
              onSubmitEditing={handleRename}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeNameDialog}>Cancel</Button>
            <Button onPress={handleRename} disabled={!nameDialog?.name.trim()}>Rename</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!choice?.open} onDismiss={() => setChoice(c => c && { ...c, open: false })}>
          <Dialog.Title>{choice?.title}</Dialog.Title>
          <Dialog.ScrollArea style={styles.choiceList}>
            <RadioButton.Group
              value={String(choice?.value)}
              onValueChange={value => {
                choice?.onPick(Number(value));
                setChoice(c => c && { ...c, value: Number(value), open: false });
              }}
            >
              {choice?.options.map(o => <RadioButton.Item key={o.value} label={o.label} value={String(o.value)} />)}
            </RadioButton.Group>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setChoice(c => c && { ...c, open: false })}>Cancel</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!pinDialog?.open} onDismiss={closePinDialog}>
          <Dialog.Title>{pinTitle}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{pinMessage}</Text>
            <TextInput
              mode="outlined"
              label="PIN"
              value={pinDialog?.pin ?? ''}
              onChangeText={pin => setPinDialog(d => d && { ...d, pin: pin.replace(/\D/g, '').slice(0, 4) })}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              onSubmitEditing={submitPin}
              style={styles.dialogInput}
            />
            {pinDialog && pinDialog.profile.id !== activeId && (
              <Button onPress={() => handleForgotPin(pinDialog.profile)} style={styles.forgotPin}>Forgot PIN?</Button>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closePinDialog}>Cancel</Button>
            <Button onPress={submitPin} disabled={pinDialog?.pin.length !== 4}>{pinAction}</Button>
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
  choiceList: {
    paddingHorizontal: 0,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogInput: {
    marginTop: space.md,
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
