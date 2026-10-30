import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, Icon, IconButton, List, RadioButton, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import M3Switch from '../components/M3Switch';
import { RootStackParamList } from '../types';
import { deleteAllNotesForever, getShareTarget, moveAllNotesToBin, restoreBatch, setShareTarget, ShareTarget } from '../storage/notes';
import { isRediscoverOn, setRediscoverOn } from '../utils/rediscover';
import { isLiveRelatedOn, setLiveRelatedOn } from '../utils/liveRelated';
import { isMeaningSearchAvailable } from '../storage/semanticSearch';
import { getStartScreen, setStartScreen, START_SCREENS, startScreenLabel, StartScreen } from '../utils/startScreen';
import { formatHour, getReminderHour, REMINDER_HOURS, setReminderHour } from '../utils/taskReminders';
import { AUTO_LOCK_MINUTES, deleteProfileForever, eraseForgottenProfile, getActiveProfile, getAutoLockMinutes, setAutoLockMinutes, getBinnedProfiles, getDefaultProfile, getProfiles, hasProfilePin, moveProfileToBin, Profile, renameProfile, restoreProfile, setDefaultProfile, switchProfile, unlockWithBiometrics, usesBiometrics, verifyProfilePin, wrongPinMessage } from '../storage/profiles';
import { BIN_DAYS } from '../storage/database';
import { LANGUAGES } from '@notespark/core';
import { useI18n } from '../i18n/I18nContext';
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

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Settings'>>();
  const { theme, themeType, setThemeType } = useTheme();
  const { t, language, preference, setPreference } = useI18n();
  const profileTimeLeft = (deletedAt: string) => {
    const days = BIN_DAYS - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000);
    if (days <= 0) return t('settings.erasedNextOpen');
    if (days === 1) return t('settings.erasedTomorrow');
    return t('settings.erasedInDays', { count: days });
  };
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
  const [liveRelated, setLiveRelated] = useState(false);
  const [startScreen, setStartScreenState] = useState<StartScreen>('Home');
  // A pick-one dialog (reminder time, auto-lock); kept after closing so it doesn't change while fading.
  const [choice, setChoice] = useState<{ title: string; options: { label: string; value: string | number }[]; value: string | number; onPick: (value: any) => void; open: boolean } | null>(null);
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
    setStartScreenState(await getStartScreen());
    setLiveRelated(await isLiveRelatedOn());
  }, []);

  const lockLabel = (minutes: number) => (minutes === 0 ? t('settings.lockRightAway') : t('settings.lockAfterMinutes', { count: minutes }));
  const pickReminderHour = () =>
    setChoice({
      title: t('settings.taskReminders'),
      options: REMINDER_HOURS.map(h => ({ label: formatHour(h), value: h })),
      value: reminderHour,
      onPick: hour => {
        setReminderHourState(hour);
        setReminderHour(hour).catch(() => alert(t('settings.remindersFailed'), t('common.tryAgainRestart')));
      },
      open: true,
    });
  const shareTargets: ShareTarget[] = ['scratchpad', 'note'];
  const shareLabel = (target: ShareTarget) => (target === 'scratchpad' ? t('settings.shareScratchpad') : t('settings.shareNote'));
  const pickShareTarget = () =>
    setChoice({
      title: t('settings.sharedText'),
      options: shareTargets.map((target, i) => ({ label: shareLabel(target), value: i })),
      value: shareTargets.indexOf(shareTarget),
      onPick: i => {
        setShareTargetState(shareTargets[i]);
        setShareTarget(shareTargets[i]).catch(() => {});
      },
      open: true,
    });
  const pickStartScreen = () =>
    setChoice({
      title: t('settings.openAppOn'),
      options: START_SCREENS.map((screen, i) => ({ label: startScreenLabel(screen), value: i })),
      value: START_SCREENS.indexOf(startScreen),
      onPick: i => {
        setStartScreenState(START_SCREENS[i]);
        setStartScreen(START_SCREENS[i]).catch(() => alert(t('settings.startScreenFailed'), t('common.tryAgainRestart')));
      },
      open: true,
    });
  const languageName = LANGUAGES.find(l => l.code === language)?.name ?? '';
  const pickLanguage = () =>
    setChoice({
      title: t('settings.language'),
      options: [{ label: t('settings.languageSystem'), value: 'system' }, ...LANGUAGES.map(l => ({ label: l.name, value: l.code }))],
      value: preference,
      onPick: value => {
        setPreference(value as typeof preference)
          .then(restart => { if (restart) alert(t('settings.languageRestartTitle'), t('settings.languageRestartBody')); })
          .catch(() => {});
      },
      open: true,
    });
  const pickAutoLock = () =>
    setChoice({
      title: t('settings.lockAgain'),
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
      alert(t('settings.renameFailed'), t('common.tryAgainRestart'));
    }
  };

  const confirmMakeDefault = (profile: Profile) => {
    if (profile.id === defaultId) return;
    alert(
      t('settings.changeDefaultTitle'),
      t('settings.changeDefaultBody', { name: profile.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.makeDefault'), onPress: () => handleMakeDefault(profile) },
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
        alert(t('profiles.incorrectPin'), await wrongPinMessage(profile.id));
        return;
      }
      await setDefaultProfile(profile.id, pin ?? '');
      await loadProfiles();
      closePinDialog();
      setSnackbar(t('settings.nowDefault', { name: profile.name }));
    } catch (error) {
      alert(
        t('profiles.cantOpenTitle', { name: profile.name }),
        t('profiles.cantOpenBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('profiles.eraseAction'), style: 'destructive', onPress: () => handleForgotPin(profile) },
        ]
      );
    }
  };

  const isProtected = (profile: Profile) => protectedProfileIds.includes(profile.id);

  // A PIN can't be recovered, so a forgotten one means erasing the profile.
  const handleForgotPin = (profile: Profile) => {
    closePinDialog();
    alert(
      t('profiles.eraseTitle'),
      t('profiles.eraseBody', { name: profile.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profiles.eraseAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await eraseForgottenProfile(profile.id);
              await loadProfiles();
              setSnackbar(t('profiles.erased', { name: profile.name }));
            } catch (error) {
              alert(t('profiles.eraseFailed'), t('common.tryAgainRestart'));
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
        alert(t('profiles.incorrectPin'), await wrongPinMessage(profile.id));
        return;
      }
      closePinDialog();
      await switchProfile(profile.id, enteredPin);
      await loadProfiles();
    } catch (error) {
      alert(
        t('profiles.cantOpenTitle', { name: profile.name }),
        t('profiles.cantOpenBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('profiles.eraseAction'), style: 'destructive', onPress: () => handleForgotPin(profile) },
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
      alert(t('profiles.incorrectPin'), await wrongPinMessage(profile.id));
      return;
    }
    closePinDialog();
    alert(
      t('settings.deleteProfileTitle'),
      t('settings.deleteProfileBody', { name: profile.name, days: BIN_DAYS }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteProfile'),
          style: 'destructive',
          onPress: async () => {
            try {
              await moveProfileToBin(profile.id, pin);
              await loadProfiles();
              setSnackbar(t('settings.profileDeleted'));
            } catch (error) {
              alert(t('settings.deleteProfileFailed'), t('common.tryAgainRestart'));
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
      setSnackbar(t('settings.profileRestored'));
    } catch (error) {
      alert(t('settings.restoreProfileFailed'), t('common.tryAgainRestart'));
    }
  };

  const handleDeleteProfileForever = (profile: Profile) => {
    alert(
      t('settings.deleteForeverTitle'),
      t('settings.deleteForeverBody', { name: profile.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteForeverAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProfileForever(profile.id);
              await loadProfiles();
              setSnackbar(t('settings.profileDeletedForever'));
            } catch (error) {
              alert(t('settings.deleteProfileFailed'), t('common.tryAgainRestart'));
            }
          },
        },
      ]
    );
  };

  const handleMoveAllToBin = () => {
    alert(
      t('settings.moveAllTitle'),
      t('settings.moveAllBody', { name: activeName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.moveAllAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              setUndoBatch(await moveAllNotesToBin());
              setSnackbar(t('settings.allMovedToBin'));
            } catch (error) {
              alert(t('settings.moveAllFailed'), t('common.tryAgainRestart'));
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllForever = () => {
    alert(
      t('settings.deleteAllTitle'),
      t('settings.deleteAllBody', { name: activeName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteForeverAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAllNotesForever();
              setUndoBatch(null);
              setSnackbar(t('settings.allDeletedForever'));
            } catch (error) {
              alert(t('settings.deleteAllFailed'), t('common.tryAgainRestart'));
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
      alert(t('settings.restoreNotesFailed'), t('settings.restoreNotesFailedBody'));
    }
  };

  const pinName = pinDialog?.profile.name ?? '';
  const { pinTitle, pinMessage, pinAction } = {
    unlock: { pinTitle: t('settings.pinUnlockTitle'), pinMessage: t('settings.pinUnlockBody', { name: pinName }), pinAction: t('profiles.unlock') },
    makeDefault: { pinTitle: t('settings.pinDefaultTitle'), pinMessage: t('settings.pinDefaultBody', { name: pinName }), pinAction: t('settings.openAtStart') },
    delete: { pinTitle: t('settings.pinDeleteTitle'), pinMessage: t('settings.pinDeleteBody', { name: pinName }), pinAction: t('settings.deleteProfile') },
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
        title={t('common.settings')}
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.column}>
          {sectionTitle(t('settings.appearance'))}
          <SegmentedButtons theme={controlTheme}
            value={themeType}
            onValueChange={value => setThemeType(value as 'light' | 'dark' | 'system')}
            buttons={[
              { value: 'light', label: t('settings.themeLight'), icon: 'white-balance-sunny' },
              { value: 'dark', label: t('settings.themeDark'), icon: 'weather-night' },
              { value: 'system', label: t('settings.themeSystem'), icon: 'theme-light-dark' },
            ]}
          />
          <GroupedRow
            title={t('settings.language')}
            description={preference === 'system' ? t('settings.languageSystemNamed', { system: t('settings.languageSystem'), name: languageName }) : languageName}
            icon="translate"
            right={chevron}
            onPress={pickLanguage}
            isFirst
            isLast
          />

          {sectionTitle(t('settings.notesAndTasks'))}
          <GroupedRow
            title={t('settings.openAppOn')}
            description={startScreenLabel(startScreen)}
            icon="home-outline"
            right={chevron}
            onPress={pickStartScreen}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title={t('settings.rediscover')}
            description={t('settings.rediscoverDescription')}
            icon="history"
            right={
              <M3Switch
                value={rediscover}
                onValueChange={on => { setRediscover(on); setRediscoverOn(on).catch(() => {}); }}
                accessibilityLabel={t('settings.rediscover')}
              />
            }
            onPress={() => { setRediscover(!rediscover); setRediscoverOn(!rediscover).catch(() => {}); }}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title={t('settings.relatedWhileWriting')}
            description={isMeaningSearchAvailable()
              ? t('settings.relatedDescription')
              : t('settings.relatedUnavailable')}
            icon="lightbulb-outline"
            right={
              <M3Switch
                value={liveRelated}
                onValueChange={on => { setLiveRelated(on); setLiveRelatedOn(on).catch(() => {}); }}
                accessibilityLabel={t('settings.relatedWhileWriting')}
                disabled={!isMeaningSearchAvailable()}
              />
            }
            onPress={() => { setLiveRelated(!liveRelated); setLiveRelatedOn(!liveRelated).catch(() => {}); }}
            disabled={!isMeaningSearchAvailable()}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title={t('settings.sharedText')}
            description={shareLabel(shareTarget)}
            icon="share-variant-outline"
            right={chevron}
            onPress={pickShareTarget}
            isFirst={false}
            isLast={false}
          />
          <GroupedRow
            title={t('settings.taskReminders')}
            description={t('settings.taskRemindersDescription', { time: formatHour(reminderHour) })}
            icon="bell-outline"
            right={chevron}
            onPress={pickReminderHour}
            isFirst={false}
            isLast
          />

          {sectionTitle(t('settings.profiles'))}
          {profiles.map((p, i) => {
            const current = p.id === activeId;
            const isDefault = p.id === defaultId;
            const lockIcon = fingerprintProfileIds.includes(p.id) ? 'fingerprint' : isProtected(p) ? 'lock-outline' : null;
            const status = current ? (isDefault ? t('settings.statusCurrentDefault') : t('settings.statusCurrent')) : isDefault ? t('settings.statusDefault') : t('settings.statusOther');
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
                      <View accessible accessibilityLabel={lockIcon === 'fingerprint' ? t('settings.lockedFingerprint') : t('settings.lockedPin')}>
                        <Icon source={lockIcon} size={18} color={theme.colors.onSurfaceVariant} />
                      </View>
                    )}
                    <Menu
                      visible={menuFor === p.id}
                      onDismiss={() => setMenuFor(null)}
                      anchor={<IconButton icon="dots-vertical" accessibilityLabel={t('settings.optionsFor', { name: p.name })} onPress={() => setMenuFor(p.id)} />}
                    >
                      {!current && (
                        <Menu.Item leadingIcon="swap-horizontal" title={t('settings.switchToProfile')} onPress={() => { setMenuFor(null); handleSwitch(p); }} />
                      )}
                      <Menu.Item leadingIcon="pencil-outline" title={t('common.rename')} onPress={() => { setMenuFor(null); setNameDialog({ profile: p, name: p.name, open: true }); }} />
                      <Menu.Item leadingIcon="lock-outline" title={t('settings.menuLock')} onPress={() => { setMenuFor(null); navigation.navigate('ProfileLock', { profileId: p.id }); }} />
                      {!isDefault && (
                        <Menu.Item leadingIcon="star-outline" title={t('settings.openAtStart')} onPress={() => { setMenuFor(null); confirmMakeDefault(p); }} />
                      )}
                      {/* The open and default profiles can't be deleted. */}
                      {!current && !isDefault && (
                        <Menu.Item
                          leadingIcon="delete-outline"
                          title={t('settings.deleteProfile')}
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
            title={t('settings.addProfile')}
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
              title={t('settings.lockAgain')}
              description={t('settings.lockAgainDescription', { when: lockLabel(autoLock) })}
              icon="lock-clock"
              right={chevron}
              onPress={pickAutoLock}
              isFirst={false}
              isLast
            />
          )}

          {binnedProfiles.length > 0 && sectionTitle(t('settings.deletedProfiles'))}
          {binnedProfiles.map((p, i) => (
            <GroupedRow
              key={p.id}
              title={p.name}
              description={profileTimeLeft(p.deletedAt!)}
              icon="account-remove-outline"
              right={
                <View style={styles.rowActions}>
                  <IconButton icon="restore" accessibilityLabel={t('settings.restoreProfile', { name: p.name })} onPress={() => handleRestoreProfile(p)} />
                  <IconButton icon="delete-forever-outline" accessibilityLabel={t('settings.deleteProfileForever', { name: p.name })} onPress={() => handleDeleteProfileForever(p)} />
                </View>
              }
              isFirst={i === 0}
              isLast={i === binnedProfiles.length - 1}
            />
          ))}

          {sectionTitle(t('settings.backupAndStorage'))}
          <GroupedRow
            title={t('settings.importExport')}
            description={t('settings.importExportDescription')}
            icon="swap-vertical"
            right={chevron}
            onPress={() => navigation.navigate('ImportExport')}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title={t('settings.bin')}
            description={t('settings.binDescription')}
            icon="delete-restore"
            right={chevron}
            onPress={() => navigation.navigate('Bin')}
            isFirst={false}
            isLast={false}
          />
          {/* The swap button flips this row between moving to the bin and erasing without it. */}
          <GroupedRow
            title={deleteMode === 'bin' ? t('settings.moveAllToBin') : t('settings.deleteAllForever')}
            description={deleteMode === 'bin' ? t('settings.moveAllToBinDescription') : t('settings.deleteAllForeverDescription')}
            icon={deleteMode === 'bin' ? 'delete-sweep-outline' : 'delete-forever-outline'}
            danger
            onPress={deleteMode === 'bin' ? handleMoveAllToBin : handleDeleteAllForever}
            right={
              <IconButton
                icon="swap-horizontal"
                iconColor={theme.colors.onSurfaceVariant}
                accessibilityLabel={deleteMode === 'bin' ? t('settings.switchToDeleteForever') : t('settings.switchToMoveToBin')}
                onPress={() => setDeleteMode(m => (m === 'bin' ? 'forever' : 'bin'))}
              />
            }
            isFirst={false}
            isLast
          />

          {sectionTitle(t('settings.app'))}
          <GroupedRow
            title={t('settings.about')}
            description={t('settings.aboutDescription')}
            icon="information-outline"
            right={chevron}
            onPress={() => navigation.navigate('About')}
            isFirst
            isLast={false}
          />
          <GroupedRow
            title={t('settings.privacy')}
            description={t('settings.privacyDescription')}
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
        action={undoBatch ? { label: t('common.undo'), onPress: handleUndoMoveAll } : undefined}
      >
        {snackbar}
      </Snackbar>

      <KeyboardSafePortal>
        <Dialog visible={!!nameDialog?.open} onDismiss={closeNameDialog}>
          <Dialog.Title>{t('settings.renameProfile')}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label={t('profiles.profileName')}
              value={nameDialog?.name ?? ''}
              onChangeText={name => setNameDialog(d => d && { ...d, name })}
              autoFocus
              maxLength={40}
              onSubmitEditing={handleRename}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closeNameDialog}>{t('common.cancel')}</Button>
            <Button onPress={handleRename} disabled={!nameDialog?.name.trim()}>{t('common.rename')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!choice?.open} onDismiss={() => setChoice(c => c && { ...c, open: false })}>
          <Dialog.Title>{choice?.title}</Dialog.Title>
          <Dialog.ScrollArea style={styles.choiceList}>
            <RadioButton.Group
              value={String(choice?.value)}
              onValueChange={value => {
                const picked = typeof choice?.value === 'number' ? Number(value) : value;
                choice?.onPick(picked);
                setChoice(c => c && { ...c, value: picked, open: false });
              }}
            >
              {choice?.options.map(o => <RadioButton.Item key={o.value} label={o.label} value={String(o.value)} />)}
            </RadioButton.Group>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setChoice(c => c && { ...c, open: false })}>{t('common.cancel')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!pinDialog?.open} onDismiss={closePinDialog}>
          <Dialog.Title>{pinTitle}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{pinMessage}</Text>
            <TextInput
              mode="outlined"
              label={t('profiles.pin')}
              value={pinDialog?.pin ?? ''}
              onChangeText={pin => setPinDialog(d => d && { ...d, pin: pin.replace(/\D/g, '').slice(0, 4) })}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              onSubmitEditing={submitPin}
              style={styles.dialogInput}
            />
            {pinDialog && pinDialog.profile.id !== activeId && (
              <Button onPress={() => handleForgotPin(pinDialog.profile)} style={styles.forgotPin}>{t('profiles.forgotPin')}</Button>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={closePinDialog}>{t('common.cancel')}</Button>
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
