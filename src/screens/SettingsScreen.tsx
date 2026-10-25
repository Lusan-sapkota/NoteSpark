import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View, ScrollView } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, Icon, IconButton, List, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { deleteAllNotesForever, moveAllNotesToBin, restoreBatch } from '../storage/notes';
import { addProfile, deleteProfileForever, eraseForgottenProfile, getActiveProfile, getBinnedProfiles, getDefaultProfile, getProfiles, hasProfilePin, moveProfileToBin, Profile, renameProfile, restoreProfile, setDefaultProfile, setProfilePin, setUsesBiometrics, switchProfile, unlockWithBiometrics, usesBiometrics, canUseBiometrics, verifyProfilePin, wrongPinMessage } from '../storage/profiles';
import { BIN_DAYS } from '../storage/database';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import KeyboardSafePortal, { useDialogBodyMaxHeight } from '../components/KeyboardSafePortal';
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

type LockMode = 'none' | 'pin' | 'fingerprint';

const lockHelp: Record<LockMode, string> = {
  none: 'Anyone using your phone can open this profile.',
  pin: 'Asks for a four-digit PIN. Its notes are encrypted on your phone.',
  fingerprint: 'Opens with your fingerprint or the PIN. Its notes are encrypted on your phone.',
};

// One tile of the lock picker. Selected: tonal fill, primary outline and a check badge, so it isn't shown by
// color alone. A 2dp border in both states, so selecting never changes the size. Springs a little on press
// (not under reduce motion).
const LockOption: React.FC<{ icon: string; label: string; selected: boolean; muted?: boolean; onPress: () => void }> = ({
  icon,
  label,
  selected,
  muted = false,
  onPress,
}) => {
  const { theme } = useTheme();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const press = (to: number) => {
    if (!reduceMotion) scale.value = withSpring(to, { damping: 15, stiffness: 300 });
  };
  const color = selected ? theme.colors.onSecondaryContainer : muted ? theme.colors.onSurfaceVariant : theme.colors.onSurface;
  return (
    <Animated.View style={[styles.lockOption, pressStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => press(0.95)}
        onPressOut={() => press(1)}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={label}
        style={[
          styles.lockOptionInner,
          selected
            ? { backgroundColor: theme.colors.secondaryContainer, borderColor: theme.colors.primary }
            : { backgroundColor: theme.colors.surfaceContainerHighest, borderColor: theme.colors.surfaceContainerHighest },
        ]}
      >
        {selected && (
          <View style={styles.lockCheck}>
            <Icon source="check-circle" size={16} color={theme.colors.primary} />
          </View>
        )}
        <Icon source={icon} size={24} color={selected ? theme.colors.primary : color} />
        <Text variant="labelLarge" style={[styles.lockLabel, { color }]} maxFontSizeMultiplier={1.5}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
};

// "Lock": No lock, PIN, or Fingerprint (with the PIN as backup), plus one line about the choice. Without a
// fingerprint on the phone, the Fingerprint tile opens the phone's security settings instead.
const LockPicker: React.FC<{ value: LockMode; onChange: (mode: LockMode) => void; fingerprintReady: boolean }> = ({ value, onChange, fingerprintReady }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.lockChoice}>
      <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>Lock</Text>
      <View style={styles.lockOptions} accessibilityRole="radiogroup">
        <LockOption icon="lock-open-variant-outline" label="No lock" selected={value === 'none'} onPress={() => onChange('none')} />
        <LockOption icon="dialpad" label="PIN" selected={value === 'pin'} onPress={() => onChange('pin')} />
        <LockOption
          icon={fingerprintReady ? 'fingerprint' : 'fingerprint-off'}
          label="Fingerprint"
          selected={value === 'fingerprint'}
          muted={!fingerprintReady}
          onPress={() =>
            fingerprintReady
              ? onChange('fingerprint')
              : Linking.sendIntent('android.settings.SECURITY_SETTINGS').catch(() => Linking.openSettings())
          }
        />
      </View>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {lockHelp[value]}
        {!fingerprintReady && ' To use a fingerprint, add one in your phone\'s settings first.'}
      </Text>
    </View>
  );
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
  const [fingerprintProfileIds, setFingerprintProfileIds] = useState<string[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const dialogBodyMax = useDialogBodyMaxHeight();
  // Kept after closing so the text doesn't change while the dialog fades out. `lock`: Add profile's lock picker.
  const [nameDialog, setNameDialog] = useState<{ editing: Profile | null; name: string; pin: string; pinConfirmation: string; lock: LockMode; open: boolean } | null>(null);
  // `lock`: the Profile lock picker (manage mode).
  const [pinDialog, setPinDialog] = useState<{ profile: Profile; pin: string; pinConfirmation: string; currentPin: string; lock: LockMode; mode: 'unlock' | 'manage' | 'makeDefault' | 'delete'; open: boolean } | null>(null);
  const [fingerprintReady, setFingerprintReady] = useState(false);
  const checkFingerprint = () => canUseBiometrics().then(setFingerprintReady).catch(() => setFingerprintReady(false));
  const openPinDialog = async (profile: Profile, mode: 'unlock' | 'manage' | 'makeDefault' | 'delete') => {
    let lock: LockMode = 'pin';
    if (mode === 'manage') {
      await checkFingerprint();
      if (isProtected(profile) && (await usesBiometrics(profile.id).catch(() => false))) lock = 'fingerprint';
    }
    setPinDialog({ profile, pin: '', pinConfirmation: '', currentPin: '', lock, mode, open: true });
  };
  const openAddDialog = async () => {
    await checkFingerprint();
    setNameDialog({ editing: null, name: '', pin: '', pinConfirmation: '', lock: 'none', open: true });
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
    const idsWhere = async (test: (id: string) => Promise<boolean>) =>
      (await Promise.all(list.map(async profile => ((await test(profile.id)) ? profile.id : null)))).filter((id): id is string => id !== null);
    setProtectedProfileIds(await idsWhere(hasProfilePin));
    setFingerprintProfileIds(await idsWhere(usesBiometrics));
  }, []);

  useFocusEffect(useCallback(() => { loadProfiles().catch(() => {}); }, [loadProfiles]));

  // Back from the phone's settings (after "Open settings" in the PIN dialog): check for a fingerprint again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkFingerprint();
    });
    return () => sub.remove();
  }, []);

  const activeName = profiles.find(p => p.id === activeId)?.name ?? '';

  const handleSaveName = async () => {
    if (!nameDialog) return;
    const name = nameDialog.name.trim();
    if (!name) return;
    try {
      if (nameDialog.editing) await renameProfile(nameDialog.editing.id, name);
      else {
        const { lock, pin, pinConfirmation } = nameDialog;
        if (lock !== 'none' && (pin !== pinConfirmation || !/^\d{4}$/.test(pin))) return;
        const profile = await addProfile(name, lock === 'none' ? undefined : pin);
        if (lock === 'fingerprint' && fingerprintReady) await setUsesBiometrics(profile.id, true);
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

  // Profile lock: a protected profile needs its current PIN for any change; the new PIN is optional when keeping a
  // lock. "No lock" removes the PIN (and with it encryption), after asking.
  const handleSaveLock = async () => {
    if (!pinDialog || pinDialog.mode !== 'manage') return;
    const { profile, pin, pinConfirmation, currentPin, lock } = pinDialog;
    const locked = isProtected(profile);
    const newPinOk = pin.length === 4 && pin === pinConfirmation;
    if (lock !== 'none' && (locked ? !!(pin || pinConfirmation) && !newPinOk : !newPinOk)) return;
    if (!locked && lock === 'none') return;
    try {
      if (locked && !(await checkCurrentPin(profile, currentPin))) return;
      if (lock === 'none') {
        alert('Remove the lock?', `${profile.name} will open without a PIN, and its notes won't be encrypted any more.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove lock',
            style: 'destructive',
            onPress: async () => {
              try {
                await setProfilePin(profile.id, null, currentPin);
                closePinDialog();
                await loadProfiles();
                setSnackbar(`Lock removed from ${profile.name}`);
              } catch (error) {
                alert("Couldn't remove the lock", 'Try again. If it keeps failing, restart the app.');
              }
            },
          },
        ]);
        return;
      }
      if (pin) await setProfilePin(profile.id, pin, currentPin);
      await setUsesBiometrics(profile.id, lock === 'fingerprint' && fingerprintReady);
      closePinDialog();
      await loadProfiles();
      setSnackbar(`Lock saved for ${profile.name}`);
    } catch (error) {
      alert("Couldn't save the lock", 'Try again. If it keeps failing, restart the app.');
    }
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
      ? { pinTitle: 'Profile lock', pinMessage: `Enter the current PIN for ${pinName} to change how it locks.`, pinAction: 'Save' }
      : { pinTitle: 'Profile lock', pinMessage: `Choose how ${pinName} locks.`, pinAction: 'Save' },
  }[pinDialog?.mode ?? 'unlock'];
  const submitPin = () => {
    if (!pinDialog) return;
    const { profile, pin, mode } = pinDialog;
    if (mode === 'manage') handleSaveLock();
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
          {profiles.map((p, i) => {
            const current = p.id === activeId;
            const isDefault = p.id === defaultId;
            const lockLabel = fingerprintProfileIds.includes(p.id) ? { icon: 'fingerprint', text: 'Fingerprint' } : isProtected(p) ? { icon: 'lock-outline', text: 'PIN' } : null;
            // Small status labels instead of a sentence; a profile with none of them is a one-line row.
            const labels = [
              current && { icon: 'check', text: 'Current', highlight: true },
              isDefault && { icon: 'star-outline', text: 'Opens at start', highlight: false },
              lockLabel && { ...lockLabel, highlight: false },
            ].filter(Boolean) as { icon: string; text: string; highlight: boolean }[];
            return (
              <GroupedRow
                key={p.id}
                title={p.name}
                description={labels.length ? (
                  <View style={styles.labels}>
                    {labels.map(l => (
                      <View key={l.text} style={[styles.label, { backgroundColor: l.highlight ? theme.colors.secondaryContainer : theme.colors.surfaceContainerHighest }]}>
                        <Icon source={l.icon} size={14} color={l.highlight ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant} />
                        <Text variant="labelMedium" maxFontSizeMultiplier={1.5} style={{ color: l.highlight ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant }}>
                          {l.text}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : undefined}
                icon={current ? 'account-check' : 'account-outline'}
                onPress={current ? undefined : () => handleSwitch(p)}
                right={
                  <Menu
                    visible={menuFor === p.id}
                    onDismiss={() => setMenuFor(null)}
                    anchor={<IconButton icon="dots-vertical" accessibilityLabel={`Options for ${p.name}`} onPress={() => setMenuFor(p.id)} />}
                  >
                    {!current && (
                      <Menu.Item leadingIcon="swap-horizontal" title="Switch to this profile" onPress={() => { setMenuFor(null); handleSwitch(p); }} />
                    )}
                    <Menu.Item
                      leadingIcon="pencil-outline"
                      title="Rename"
                      onPress={() => { setMenuFor(null); setNameDialog({ editing: p, name: p.name, pin: '', pinConfirmation: '', lock: 'none', open: true }); }}
                    />
                    <Menu.Item leadingIcon="lock-outline" title="Profile lock" onPress={() => { setMenuFor(null); openPinDialog(p, 'manage'); }} />
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
                }
                isFirst={i === 0}
                isLast={false}
              />
            );
          })}
          <GroupedRow
            title="Add profile"
            description="A separate set of notes, for work or school"
            icon="account-plus-outline"
            onPress={openAddDialog}
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
            {/* Scrolls inside the space above the keyboard, so the title and buttons stay on screen. */}
            <ScrollView style={{ maxHeight: dialogBodyMax }} keyboardShouldPersistTaps="handled">
              <TextInput
                mode="outlined"
                label="Profile name"
                value={nameDialog?.name ?? ''}
                onChangeText={name => setNameDialog(d => d && { ...d, name })}
                autoFocus
                onSubmitEditing={handleSaveName}
              />
              {nameDialog && !nameDialog.editing && (
                <>
                  <LockPicker value={nameDialog.lock} onChange={lock => setNameDialog(d => d && { ...d, lock })} fingerprintReady={fingerprintReady} />
                  {nameDialog.lock !== 'none' && (
                    <>
                      <TextInput
                        mode="outlined"
                        label="Four-digit PIN"
                        value={nameDialog.pin}
                        onChangeText={pin => setNameDialog(d => d && { ...d, pin: digits(pin) })}
                        keyboardType="number-pad"
                        secureTextEntry
                        style={styles.dialogInput}
                      />
                      <TextInput
                        mode="outlined"
                        label="Confirm PIN"
                        value={nameDialog.pinConfirmation}
                        onChangeText={pinConfirmation => setNameDialog(d => d && { ...d, pinConfirmation: digits(pinConfirmation) })}
                        keyboardType="number-pad"
                        secureTextEntry
                        onSubmitEditing={handleSaveName}
                        style={styles.dialogInput}
                      />
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeNameDialog}>Cancel</Button>
            <Button
              onPress={handleSaveName}
              disabled={!nameDialog?.name.trim() || (!nameDialog.editing && nameDialog.lock !== 'none' && (nameDialog.pin.length !== 4 || nameDialog.pin !== nameDialog.pinConfirmation))}
            >
              {nameDialog?.editing ? 'Rename' : 'Add profile'}
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!pinDialog?.open} onDismiss={closePinDialog}>
          <Dialog.Title>{pinTitle}</Dialog.Title>
          <Dialog.Content>
            <ScrollView style={{ maxHeight: dialogBodyMax }} keyboardShouldPersistTaps="handled">
              <Text variant="bodyMedium">{pinMessage}</Text>
              {pinDialog?.mode === 'manage' ? (
                <>
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
                  <LockPicker value={pinDialog.lock} onChange={lock => setPinDialog(d => d && { ...d, lock })} fingerprintReady={fingerprintReady} />
                  {pinDialog.lock !== 'none' && (
                    <>
                      <TextInput
                        mode="outlined"
                        label={changingPin ? 'New PIN (optional)' : 'Four-digit PIN'}
                        value={pinDialog.pin}
                        onChangeText={pin => setPinDialog(d => d && { ...d, pin: digits(pin) })}
                        keyboardType="number-pad"
                        secureTextEntry
                        style={styles.dialogInput}
                      />
                      <TextInput
                        mode="outlined"
                        label={changingPin ? 'Confirm new PIN' : 'Confirm PIN'}
                        value={pinDialog.pinConfirmation}
                        onChangeText={pinConfirmation => setPinDialog(d => d && { ...d, pinConfirmation: digits(pinConfirmation) })}
                        keyboardType="number-pad"
                        secureTextEntry
                        onSubmitEditing={handleSaveLock}
                        style={styles.dialogInput}
                      />
                    </>
                  )}
                </>
              ) : (
                <TextInput
                  mode="outlined"
                  label="PIN"
                  value={pinDialog?.pin ?? ''}
                  onChangeText={pin => setPinDialog(d => d && { ...d, pin: digits(pin) })}
                  keyboardType="number-pad"
                  secureTextEntry
                  autoFocus
                  onSubmitEditing={submitPin}
                  style={styles.dialogInput}
                />
              )}
              {pinDialog && isProtected(pinDialog.profile) && pinDialog.profile.id !== activeId && (
                <Button onPress={() => handleForgotPin(pinDialog.profile)} style={styles.forgotPin}>Forgot PIN?</Button>
              )}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closePinDialog}>Cancel</Button>
            <Button
              onPress={submitPin}
              disabled={
                !pinDialog ||
                (pinDialog.mode !== 'manage'
                  ? pinDialog.pin.length !== 4
                  : changingPin
                  ? pinDialog.currentPin.length !== 4 ||
                    (pinDialog.lock !== 'none' && !!(pinDialog.pin || pinDialog.pinConfirmation) && (pinDialog.pin.length !== 4 || pinDialog.pin !== pinDialog.pinConfirmation))
                  : pinDialog.lock === 'none' || pinDialog.pin.length !== 4 || pinDialog.pin !== pinDialog.pinConfirmation)
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
  labels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: space.xs,
  },
  // Status label on a profile row: icon and text, 8dp corners like the labels on notes.
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: shape.small,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  dialogInput: {
    marginTop: space.md,
  },
  lockChoice: {
    marginTop: space.lg,
    gap: space.sm,
  },
  lockLabel: {
    textAlign: 'center',
  },
  lockOptions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  lockOption: {
    flex: 1,
  },
  // Fills the tile, so all tiles are as tall as the tallest; they grow with large text instead of clipping.
  lockOptionInner: {
    flex: 1,
    borderWidth: 2,
    minHeight: 80,
    borderRadius: shape.control,
    paddingHorizontal: space.xs,
    paddingVertical: space.md,
    gap: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCheck: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
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
