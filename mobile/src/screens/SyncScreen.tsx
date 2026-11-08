import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Clipboard, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, HelperText, Icon, Portal, Text, TextInput } from 'react-native-paper';
import Dialog from '../components/Dialog';
import { PairingError, type PairingLink, deviceId, parsePairing } from '@notespark/sync-protocol';
import Header, { useHeaderElevation } from '../components/Header';
import ScanCode from '../components/ScanCode';
import GroupedRow from '../components/GroupedRow';
import M3Switch from '../components/M3Switch';
import Snackbar from '../components/Snackbar';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { isSyncSettingsOn, setSyncSettingsOn, syncSettings } from '../utils/syncedSettings';
import { useI18n } from '../i18n/I18nContext';
import { controlTheme, readingWidth, shape, space } from '../theme/theme';
import { db } from '../storage/database';
import { getActiveProfile } from '../storage/profiles';
import { type HubRecord, forgetHub, getHubs, saveHub, setProfileSync, syncedProfiles } from '../sync/pairings';
import { askBackgroundPermission, clearLockedMatch, getPendingLink, getPendingPick, getSyncStatus, reconcileSync, relinkOpenProfile, setPairingToken, subscribeSync, syncDiagnostics, syncNow } from '../sync/syncRuntime';

const SyncScreen: React.FC = () => {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { t } = useI18n();
  const alert = useAlert();
  const { elevated, onScroll } = useHeaderElevation();
  const status = useSyncExternalStore(subscribeSync, getSyncStatus);
  const pendingLink = useSyncExternalStore(subscribeSync, getPendingLink);
  const pendingPick = useSyncExternalStore(subscribeSync, getPendingPick);
  const [hubs, setHubs] = useState<HubRecord[]>([]);
  const [profile, setProfile] = useState<{ id: string; name: string } | null>(null);
  const [on, setOn] = useState(false);
  const [settingsOn, setSettingsOn] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [here, setHere] = useState(0);
  const [snackbar, setSnackbar] = useState('');
  const [repair, setRepair] = useState(false);
  const [scanning, setScanning] = useState(false);
  const hub = hubs[0] ?? null; // ponytail: one computer per phone in v1

  const load = useCallback(async () => {
    const p = await getActiveProfile();
    setProfile({ id: p.id, name: p.name });
    setHubs(await getHubs());
    setOn(!!(await syncedProfiles())[p.id]);
    setSettingsOn(await isSyncSettingsOn());
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (pendingLink) db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM notes').then(r => setHere(r?.n ?? 0), () => {});
  }, [pendingLink]);
  useEffect(() => {
    if (status.lockedMatch) {
      setSnackbar(t('sync.lockedMatchNotice', { name: status.lockedMatch }));
      clearLockedMatch();
    }
  }, [status.lockedMatch, t]);

  const errorFor = (e: unknown) => {
    const reason = e instanceof PairingError ? e.reason : 'format';
    return t(reason === 'checksum' ? 'sync.errChecksum' : reason === 'version' ? 'sync.errVersion' : reason === 'address' ? 'sync.errAddress' : 'sync.errFormat');
  };

  const finishPairing = async (link: PairingLink) => {
    const record = await saveHub(link);
    if (profile) await setProfileSync(profile.id, record.id);
    setPairingToken(link.token); // kept in memory for the first session only
    await askBackgroundPermission(); // asked now that sync is turned on; refused means sync while the app is open
    setCode('');
    setRepair(false);
    await load();
    await reconcileSync();
  };

  // A scan or a paste never pairs by itself: the person sees the computer's name and device ID first.
  const handleLink = (text: string) => {
    let link: PairingLink;
    try { link = parsePairing(text); } catch (e) { return setError(errorFor(e)); }
    setError('');
    const id = deviceId(link.hubKey);
    const go = () => { void finishPairing(link); };
    if (hub && hub.id !== id) {
      alert(t('sync.replaceTitle', { name: hub.name }), t('sync.replaceBody', { name: hub.name }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('sync.replace'), style: 'destructive', onPress: async () => { await forgetHub(hub.id); go(); } },
      ]);
    } else {
      alert(t('sync.confirmTitle', { name: link.name }), t('sync.confirmBody', { id }), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => link.token.fill(0) },
        { text: t('sync.pair'), onPress: go },
      ]);
    }
  };

  const toggle = async (value: boolean) => {
    if (!profile || !hub) return;
    setOn(value);
    if (value) await askBackgroundPermission();
    await setProfileSync(profile.id, value ? hub.id : null);
    await reconcileSync();
  };

  const forget = () => {
    if (!hub) return;
    alert(t('sync.forgetTitle', { name: hub.name }), t('sync.forgetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sync.forget'), style: 'destructive', onPress: async () => { await forgetHub(hub.id); await load(); await reconcileSync(); setSnackbar(t('sync.forgotten')); } },
    ]);
  };

  const copyDiagnostics = () => { Clipboard.setString(syncDiagnostics()); setSnackbar(t('sync.diagnosticsCopied')); };

  const statusText = () => {
    if (!on) return t('sync.stateOff');
    if (status.problem && status.problemCode === 413) return t('sync.stateTooLarge');
    if (status.problem && status.state !== 'locked' && status.state !== 'notLinked' && status.state !== 'needsUpdate') return t('sync.stateProblem');
    switch (status.state) {
      case 'live': return t('sync.stateLive', { time: new Date(status.lastSynced ?? Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
      case 'connecting': return status.attempts > 0 ? t('sync.stateWaiting') : t('sync.stateSearching');
      case 'syncing': return t('sync.stateSyncing');
      case 'notLinked': return status.closeReason === 'new profiles off' ? t('sync.stateNewProfilesOff') : t('sync.stateNeedsPairing');
      case 'needsUpdate': return t('sync.stateNeedsUpdate');
      case 'locked': return t('sync.stateLocked');
      default:
        if (status.closeCode === 401) return t('sync.stateKeyMismatch');
        if (status.closeCode === 413) return t('sync.stateTooLarge');
        if (status.closeCode === 429) return t('sync.stateRateLimit');
        if (status.closeCode === 503) return t('sync.stateShuttingDown');
        if (status.closeCode === 400 || status.closeCode === 500) return t('sync.stateMalformed');
        return t('sync.stateWaiting');
    }
  };

  const muted = { color: theme.colors.onSurfaceVariant };
  const paired = !!hub && !repair;
  const keyMismatch = on && status.state === 'waiting' && status.closeCode === 401;
  const canRelink = on && status.state === 'notLinked' && status.closeReason !== 'new profiles off';
  const problem = on && (status.problem || status.state === 'notLinked' || status.state === 'needsUpdate' || keyMismatch);
  const live = on && status.state === 'live' && !problem;
  // A silent retry (after at least one failure) keeps the "can't reach" wording instead of flashing "looking" every minute.
  const retrying = on && status.state === 'connecting' && status.attempts > 0;
  const statusIcon = !on ? 'sync-off' : problem ? 'alert-circle-outline' : status.state === 'live' ? 'check-circle-outline'
    : status.state === 'locked' ? 'lock-outline' : status.state === 'waiting' || retrying ? 'lan-disconnect' : 'sync';
  const card = problem ? { bg: theme.colors.errorContainer, fg: theme.colors.onErrorContainer } : { bg: theme.colors.surfaceContainer, fg: theme.colors.onSurface };
  const slow = on && (status.state === 'waiting' || retrying) && !keyMismatch && status.attempts >= 3;

  const tips = (
    <View style={[styles.tips, { backgroundColor: theme.colors.surfaceContainerLow }]}>
      <View style={styles.tipsHead}>
        <Icon source="wifi-off" size={24} color={theme.colors.onSurfaceVariant} />
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{t('sync.noWifiTitle')}</Text>
      </View>
      <Text variant="bodyMedium" style={muted}>{t('sync.noWifiBody')}</Text>
      <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
      <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{t('sync.noNetworkTitle')}</Text>
      <Text variant="bodyMedium" style={muted}>{t('sync.noNetworkBody')}</Text>
      <Button mode="text" icon="swap-vertical" onPress={() => navigation.navigate('ImportExport' as never)} style={styles.tipAction} contentStyle={styles.buttonContent}>{t('sync.noNetworkAction')}</Button>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title={t('sync.title')} showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll} onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          {!paired ? (
            <>
              <View style={styles.hero}>
                <Text variant="headlineSmall" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>{t('sync.computerHeading')}</Text>
                <Text variant="bodyLarge" style={muted}>{t('sync.pairHelp')}</Text>
              </View>
              <Button mode="contained" theme={controlTheme} icon="qrcode-scan" onPress={() => setScanning(true)} style={styles.button} contentStyle={styles.buttonContent}>{t('sync.scan')}</Button>
              <View style={styles.paste}>
                <TextInput mode="outlined" label={t('sync.pasteInstead')} accessibilityLabel={t('sync.codeLabel')} value={code} onChangeText={v => { setCode(v); setError(''); }} multiline numberOfLines={2} autoCapitalize="none" autoCorrect={false} error={!!error} />
                {!!error && <HelperText type="error" visible>{error}</HelperText>}
                <Button mode="outlined" theme={controlTheme} disabled={!code.trim()} onPress={() => handleLink(code)} style={styles.button} contentStyle={styles.buttonContent}>{t('sync.pair')}</Button>
                {repair && <Button onPress={() => { setRepair(false); setError(''); }}>{t('common.cancel')}</Button>}
              </View>
              <Text variant="bodySmall" style={muted}>{t('sync.intro')}</Text>
              {tips}
            </>
          ) : (
            <>
              <View style={[styles.card, { backgroundColor: card.bg }]}>
                <View style={styles.cardHead}>
                  <View style={[styles.avatar, { backgroundColor: theme.colors.tertiaryContainer }]}>
                    <Icon source="laptop" size={28} color={theme.colors.onTertiaryContainer} />
                    {/* The firefly: lit only while sync is live. The status line says the same in words. */}
                    {live && <View style={[styles.firefly, { backgroundColor: theme.colors.primary, borderColor: card.bg }]} />}
                  </View>
                  <View style={styles.cardText}>
                    <Text variant="titleMedium" numberOfLines={2} style={{ color: card.fg }}>{hub!.name}</Text>
                    <Text variant="bodySmall" style={{ color: problem ? card.fg : theme.colors.onSurfaceVariant }}>{t('sync.deviceId', { id: hub!.id })}</Text>
                  </View>
                </View>
                <View style={styles.statusRow}>
                  <Icon source={statusIcon} size={20} color={card.fg} />
                  <Text variant="bodyMedium" style={[styles.statusText, { color: card.fg }]}>{on ? statusText() : t('sync.stateOff')}</Text>
                </View>
                {slow && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('sync.hintRepair')}</Text>}
              </View>

              {profile && (
                <View>
                  <GroupedRow
                    title={t('sync.profileSwitch', { name: profile.name })}
                    icon="sync"
                    right={<M3Switch value={on} onValueChange={toggle} accessibilityLabel={t('sync.profileSwitch', { name: profile.name })} />}
                    isFirst isLast={!on}
                  />
                  {on && (
                    <GroupedRow
                      title={t('sync.settingsSync')}
                      description={t('sync.settingsSyncHelp')}
                      icon="cog-sync-outline"
                      right={<M3Switch value={settingsOn} onValueChange={v => { setSettingsOn(v); void setSyncSettingsOn(v).then(() => v && syncSettings()).catch(() => {}); }} accessibilityLabel={t('sync.settingsSync')} />}
                      onPress={() => { const v = !settingsOn; setSettingsOn(v); void setSyncSettingsOn(v).then(() => v && syncSettings()).catch(() => {}); }}
                      isFirst={false} isLast={false}
                    />
                  )}
                  {on && <GroupedRow title={t('sync.syncNow')} icon="refresh" onPress={syncNow} isFirst={false} isLast={!canRelink} />}
                  {canRelink && <GroupedRow title={t('sync.relink')} icon="link-plus" onPress={() => void relinkOpenProfile()} isFirst={false} isLast />}
                </View>
              )}

              <View>
                {on && <GroupedRow title={t('sync.diagnostics')} icon="content-copy" onPress={copyDiagnostics} isFirst isLast={false} />}
                <GroupedRow title={t('sync.pairAgain')} icon="qrcode-scan" onPress={() => setRepair(true)} isFirst={!on} isLast={false} />
                <GroupedRow title={t('sync.forget')} icon="link-off" danger onPress={forget} isFirst={false} isLast />
              </View>

              {tips}
            </>
          )}
        </View>
      </ScrollView>

      <ScanCode visible={scanning} onClose={() => setScanning(false)} onCode={text => { setScanning(false); handleLink(text); }} />
      <Portal>
        <Dialog visible={!!pendingPick} onDismiss={() => pendingPick?.answer(null)}>
          <Dialog.Title>{t('sync.pickTitle')}</Dialog.Title>
          <Dialog.Content style={{ gap: space.xs }}>
            <Text variant="bodyMedium">{t('sync.pickBody', { name: pendingPick?.name ?? '' })}</Text>
            {(pendingPick?.matches ?? []).map(m => (
              <Button key={m.syncId} mode="outlined" onPress={() => pendingPick?.answer(m.syncId)} style={styles.button} contentStyle={styles.buttonContent}>
                {t('sync.pickRow', { name: m.name, notes: m.notes })}
              </Button>
            ))}
            <Button mode="text" onPress={() => pendingPick?.answer('')} style={styles.button} contentStyle={styles.buttonContent}>
              {t('sync.pickNew')}
            </Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => pendingPick?.answer(null)}>{t('common.cancel')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!pendingLink} onDismiss={() => pendingLink?.answer(false)}>
          <Dialog.Title>{t('sync.linkTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('sync.linkBody', { here, there: pendingLink?.plan.hubNotes ?? 0, same: pendingLink?.plan.pairs.length ?? 0 })}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => pendingLink?.answer(false)}>{t('common.cancel')}</Button>
            <Button onPress={() => pendingLink?.answer(true)}>{t('sync.linkConfirm')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={!!snackbar} onDismiss={() => setSnackbar('')} duration={4000}>{snackbar}</Snackbar>
    </SafeAreaView>
  );
};

const AVATAR = 56;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl },
  column: { width: '100%', maxWidth: readingWidth, alignSelf: 'center', gap: space.xl },
  hero: { gap: space.sm },
  paste: { gap: space.sm },
  button: { alignSelf: 'stretch' },
  buttonContent: { minHeight: 48 },
  card: { borderRadius: shape.group, padding: space.lg, gap: space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  cardText: { flex: 1, gap: 2 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center' },
  firefly: { position: 'absolute', right: 2, top: 2, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  statusText: { flex: 1 },
  tips: { gap: space.sm, padding: space.lg, borderRadius: shape.group },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.sm },
  tipAction: { alignSelf: 'flex-start' },
  tipsHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});

export default SyncScreen;
