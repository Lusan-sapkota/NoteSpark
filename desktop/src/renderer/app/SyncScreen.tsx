import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import qrcode from 'qrcode-generator';
import { firefly } from '@notespark/core';
import Header, { useHeaderElevation } from '../../../../mobile/src/components/Header';
import GroupedRow from '../../../../mobile/src/components/GroupedRow';
import M3Switch from '../../../../mobile/src/components/M3Switch';
import { useAlert } from '../../../../mobile/src/components/DialogProvider';
import { useTheme } from '../../../../mobile/src/theme/ThemeContext';
import { space } from '../../../../mobile/src/theme/theme';
import { invoke } from './bridge';
import { useNavigation } from './nav';
import { fill, text } from './syncText';

type Profile = { id: string; name: string; synced: boolean; isProtected: boolean; locked: boolean; mirror: { state: string; message: string } | null };
type Status = { on: boolean; state: string; message: string | null; port: number | null; hosts: string[]; name: string; tunnelName: string; acceptNew: boolean; webLan: boolean; mirrorFolder: string | null; hubId: string | null; paired: string | null; profiles: Profile[] };
type Device = { key: string; id: string; name: string; lastSeen: string | null };
type Pair = { uri: string; code: string; hubId: string; expiresAt: number };

const sync = <T,>(op: string, args?: unknown) => invoke<T>('sync', { op, args });

const ago = (iso: string | null) => {
  if (!iso) return text.neverSeen;
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  const when = s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} minutes ago` : s < 129_600 ? `${Math.round(s / 3600)} hours ago` : `${Math.round(s / 86_400)} days ago`;
  return fill(text.lastSeen, { when });
};

// Always dark squares on a light tile, so every scanner reads it in light and dark mode.
const Qr = ({ value }: { value: string }) => {
  const { cells, size } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(value);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { cells: d, size: n + 8 };
  }, [value]);
  return (
    <svg role="img" aria-label="Pairing code to scan with your phone" viewBox={`0 0 ${size} ${size}`} width={240} height={240} style={{ borderRadius: 12, background: firefly.light.surfaceContainerLowest }}>
      <path d={cells} fill={firefly.light.onSurface} shapeRendering="crispEdges" />
    </svg>
  );
};

const PairDialog = ({ onClose, onDone }: { onClose: () => void; onDone: () => void }) => {
  const { theme } = useTheme();
  const [pair, setPair] = useState<Pair | null>(null);
  const [lockMin, setLockMin] = useState(0);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const start = useCallback(async () => {
    setError(''); setCopied(false);
    try {
      const p = await sync<Pair | null>('pairStart');
      if (p) { setPair(p); setLockMin(0); return; }
      const st = await sync<{ lockMsLeft: number }>('pairState');
      setPair(null); setLockMin(Math.max(1, Math.ceil(st.lockMsLeft / 60_000)));
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void start(); }, [start]);
  useEffect(() => {
    if (!pair) return;
    const tick = () => { const ms = pair.expiresAt - Date.now(); setLeft(ms); if (ms <= 0) setPair(null); }; // the code is dropped from the page at expiry
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pair]);
  const close = async () => { setPair(null); await sync('pairCancel').catch(() => {}); onClose(); };
  const mm = Math.max(0, Math.floor(left / 60_000)), ss = Math.max(0, Math.floor((left % 60_000) / 1000));
  return (
    <Portal>
      <Dialog visible onDismiss={close} style={styles.dialog}>
        <Dialog.Title>{text.pairTitle}</Dialog.Title>
        <Dialog.ScrollArea style={styles.dialogScroll}>
          <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.md, alignItems: 'flex-start' }}>
            {pair ? (
              <>
                <Text variant="bodyMedium">{text.pairHelp}</Text>
                <Qr value={pair.uri} />
                <Text variant="labelLarge" accessibilityLiveRegion="polite">{fill(text.expiresIn, { time: `${mm}:${String(ss).padStart(2, '0')}` })}</Text>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{text.pairCode}</Text>
                <Text selectable variant="bodyMedium" style={{ fontFamily: 'monospace', backgroundColor: theme.colors.surfaceContainerHigh, padding: space.sm, borderRadius: 8, maxWidth: '100%' }}>{pair.code}</Text>
                <Button mode="outlined" icon="content-copy" onPress={async () => { await invoke('sync', { op: 'copy', args: 'code' }).then(() => setCopied(true), e => setError((e as Error).message)); }}>{copied ? text.copied : text.copyCode}</Button>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{text.hubId}</Text>
                <Text variant="titleMedium" style={{ fontFamily: 'monospace' }}>{pair.hubId}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{text.hubIdHelp}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{text.usbTip}</Text>
              </>
            ) : lockMin > 0 ? (
              <Text variant="bodyMedium">{fill(text.locked, { minutes: lockMin })}</Text>
            ) : error ? (
              <Text variant="bodyMedium" style={{ color: theme.colors.error }}>{error}</Text>
            ) : left < 0 || copied ? (
              <Text variant="bodyMedium">{text.expired}</Text>
            ) : null}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          {!pair && lockMin === 0 && <Button onPress={start}>{text.startAgain}</Button>}
          <Button onPress={close}>{pair ? text.cancel : text.done}</Button>
          {pair && <Button mode="contained" onPress={() => { onDone(); void close(); }}>{text.done}</Button>}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

const DeviceRow = ({ d, first, last, reload }: { d: Device; first: boolean; last: boolean; reload: () => void }) => {
  const { theme } = useTheme();
  const alert = useAlert();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const save = async () => { await sync('rename', { key: d.key, name }).catch(() => {}); setEditing(false); reload(); };
  if (editing) {
    return (
      <View style={[styles.editRow, { backgroundColor: theme.colors.surfaceContainerLow }]}>
        <TextInput mode="outlined" label={text.renameTitle} value={name} onChangeText={setName} maxLength={64} style={{ flex: 1 }} onSubmitEditing={save} autoFocus />
        <Button onPress={() => setEditing(false)}>{text.cancel}</Button>
        <Button mode="contained" onPress={save}>{text.save}</Button>
      </View>
    );
  }
  return (
    <GroupedRow
      title={d.name}
      description={`${d.id}\n${ago(d.lastSeen)}`}
      icon="cellphone"
      isFirst={first}
      isLast={last}
      right={
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Button onPress={() => setEditing(true)} accessibilityLabel={`${text.rename} ${d.name}`}>{text.rename}</Button>
          <Button textColor={theme.colors.error} accessibilityLabel={`${text.remove} ${d.name}`}
            onPress={() => alert(fill(text.removeTitle, { name: d.name }), fill(text.removeBody, { name: d.name }), [
              { text: text.cancel, style: 'cancel' },
              { text: text.remove, style: 'destructive', onPress: () => { void sync('revoke', { key: d.key }).then(reload); } },
            ])}>{text.remove}</Button>
        </View>
      }
    />
  );
};

const SyncScreen = () => {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const [st, setSt] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState('');
  const [tunnel, setTunnel] = useState('');
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const seeded = useRef(false);
  const alert = useAlert();

  const load = useCallback(async () => {
    try {
      const s = await sync<Status>('status');
      setSt(s);
      if (!seeded.current) { seeded.current = true; setName(s.name); setTunnel(s.tunnelName); }
      setDevices(s.on && s.state === 'running' ? await sync<Device[]>('devices').catch(() => []) : []);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    window.notespark?.onSyncChanged(() => void load());
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (op: string, args?: unknown) => { setError(''); try { setSt(await sync<Status>(op, args)); } catch (e) { setError((e as Error).message); } void load(); };

  // Turning it on warns every time; turning it off just does it.
  const webLan = (on: boolean) => {
    if (!on) return void run('update', { webLan: false });
    alert(text.webLanWarnTitle, text.webLanWarnBody, [
      { text: text.cancel, style: 'cancel' },
      { text: text.webLanWarnConfirm, style: 'destructive', onPress: () => void run('update', { webLan: true }) },
    ]);
  };

  const statusText = !st ? '' : !st.on ? text.off : st.state === 'problem' ? `${st.message ?? ''} ${text.problemTail}`.trim() : st.state === 'restarting' ? text.restarting : st.state === 'running' ? text.ready : text.starting;
  const hosts = (st?.hosts ?? []).filter(h => h !== '127.0.0.1');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated} title={text.title} showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={styles.column}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{text.intro}</Text>

          <View>
            <GroupedRow title={text.turnOn} description={text.turnOnHelp} icon="sync" isFirst isLast={false}
              right={<M3Switch value={!!st?.on} onValueChange={v => void run('setOn', v)} accessibilityLabel={text.turnOn} />} onPress={() => void run('setOn', !st?.on)} />
            <GroupedRow title={text.status} description={statusText + (st?.on && st.state === 'running' ? `\n${hosts.length ? fill(text.addresses, { list: hosts.join(', '), port: st.port ?? '' }) : text.noNetwork}` : '')} icon="information-outline" isFirst={false} isLast />
          </View>
          {!!error && <Text variant="bodyMedium" style={{ color: theme.colors.error }} accessibilityLiveRegion="polite">{error}</Text>}
          {st?.paired && (
            <View style={[styles.banner, { backgroundColor: theme.colors.tertiaryContainer }]}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onTertiaryContainer, flex: 1 }} accessibilityLiveRegion="polite">{fill(text.newDevice, { name: st.paired })}</Text>
              <Button textColor={theme.colors.onTertiaryContainer} onPress={() => { void sync('ackPaired').then(load); }}>{text.done}</Button>
            </View>
          )}

          <View style={styles.row}>
            <TextInput mode="outlined" label={text.computerName} value={name} onChangeText={setName} maxLength={64} style={{ flex: 1 }} />
            <Button mode="contained-tonal" disabled={!name.trim() || name === st?.name} onPress={() => void run('update', { name })}>{text.save}</Button>
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -space.sm }}>{text.computerNameHelp}</Text>

          {st?.on && (
            <>
              <Text variant="titleMedium">{text.devices}</Text>
              <View>
                {devices.length === 0 && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{text.noDevices}</Text>}
                {devices.map((d, i) => <DeviceRow key={d.key} d={d} first={i === 0} last={i === devices.length - 1} reload={load} />)}
              </View>
              <View style={styles.row}>
                <Button mode="contained" icon="qrcode" disabled={st.state !== 'running'} onPress={() => setPairing(true)}>{text.addDevice}</Button>
              </View>
            </>
          )}

          <Text variant="titleMedium">{text.profiles}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -space.sm }}>{text.profilesHelp}</Text>
          <View>
            {(st?.profiles ?? []).map((p, i, all) => (
              <GroupedRow key={p.id} title={p.name} icon={p.isProtected ? 'lock-outline' : 'notebook-outline'} isFirst={i === 0} isLast={i === all.length - 1}
                description={p.isProtected && p.locked ? fill(text.profileLocked, { name: p.name }) : p.synced && p.mirror ? p.mirror.message : undefined}
                right={<M3Switch value={p.synced} disabled={!st?.on || (p.isProtected && p.locked && !p.synced)} onValueChange={v => void run('profileSync', { id: p.id, on: v })} accessibilityLabel={`${text.title}: ${p.name}`} />}
                onPress={st?.on ? () => void run('profileSync', { id: p.id, on: !p.synced }) : undefined} />
            ))}
          </View>
          <GroupedRow title={text.acceptNew} description={text.acceptNewHelp} icon="account-plus-outline" isFirst isLast
            right={<M3Switch value={!!st?.acceptNew} onValueChange={v => void run('update', { acceptNew: v })} accessibilityLabel={text.acceptNew} />} onPress={() => void run('update', { acceptNew: !st?.acceptNew })} />

          <Text variant="titleMedium">{text.mirror}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -space.sm }}>{text.mirrorHelp}</Text>
          <Text variant="bodyMedium" selectable>{st?.mirrorFolder ?? text.mirrorNone}</Text>
          <View style={styles.row}>
            <Button mode="outlined" icon="folder-outline" onPress={() => void run('chooseFolder')}>{text.chooseFolder}</Button>
            {!!st?.mirrorFolder && <Button onPress={() => void run('clearFolder')}>{text.clearFolder}</Button>}
          </View>

          <Text variant="titleMedium">{text.network}</Text>
          <GroupedRow title={text.webLan} description={text.webLanHelp} icon="wifi-alert" isFirst isLast
            right={<M3Switch value={!!st?.webLan} onValueChange={v => webLan(v)} accessibilityLabel={text.webLan} />} onPress={() => webLan(!st?.webLan)} />
          <View style={styles.row}>
            <TextInput mode="outlined" label={text.tunnelName} value={tunnel} onChangeText={setTunnel} autoCapitalize="none" style={{ flex: 1 }} />
            <Button mode="contained-tonal" disabled={tunnel === st?.tunnelName} onPress={() => void run('update', { tunnelName: tunnel })}>{text.save}</Button>
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -space.sm }}>{text.tunnelHelp}</Text>

          <View style={styles.row}>
            <Button mode="outlined" icon="content-copy" disabled={!st?.on || st.state !== 'running'} onPress={async () => { await invoke('sync', { op: 'copy', args: 'diagnostics' }).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, e => setError((e as Error).message)); }}>{copied ? text.copied : text.diagnostics}</Button>
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: -space.sm }}>{text.diagnosticsHelp}</Text>
        </View>
      </ScrollView>
      {pairing && <PairDialog onClose={() => setPairing(false)} onDone={() => void load()} />}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: space.lg, paddingBottom: space.xl },
  column: { width: '100%', maxWidth: 720, alignSelf: 'flex-start', gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: 16 },
  banner: { flexDirection: 'row', alignItems: 'center', padding: space.md, borderRadius: 16, gap: space.sm },
  dialog: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  dialogScroll: { maxHeight: 520, paddingHorizontal: space.lg },
});

export default SyncScreen;
