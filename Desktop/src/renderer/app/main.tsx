import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, Banner, Button, Drawer, IconButton, PaperProvider, Text } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { invoke, isDesktop, WebStatus } from './bridge';
import logo from './round.png';
import { Navigator } from './nav';
// The phone's real screens, theme and shared components, imported straight from Mobile/.
import { ThemeProvider, useTheme } from '../../../../Mobile/src/theme/ThemeContext';
import { readingWidth, space } from '../../../../Mobile/src/theme/theme';
import { DialogProvider, useAlert } from '../../../../Mobile/src/components/DialogProvider';
import HomeScreen from '../../../../Mobile/src/screens/HomeScreen';
import NoteViewScreen from '../../../../Mobile/src/screens/NoteViewScreen';
import TasksScreen from '../../../../Mobile/src/screens/TasksScreen';
import BinScreen from '../../../../Mobile/src/screens/BinScreen';
import EditorScreen from '../../../../Mobile/src/screens/EditorScreen';
import ImportExportScreen from '../../../../Mobile/src/screens/ImportExportScreen';
import ScratchpadScreen from '../../../../Mobile/src/screens/ScratchpadScreen';
import SettingsScreen from '../../../../Mobile/src/screens/SettingsScreen';
import ProfileLockScreen from '../../../../Mobile/src/screens/ProfileLockScreen';
import ProfileUnlockScreen from '../../../../Mobile/src/screens/ProfileUnlockScreen';
import AboutScreen from '../../../../Mobile/src/screens/AboutScreen';
import PrivacyScreen from '../../../../Mobile/src/screens/PrivacyScreen';
import OnboardingScreen from '../../../../Mobile/src/screens/OnboardingScreen';

const screens = {
  Home: HomeScreen,
  NoteView: NoteViewScreen,
  Tasks: TasksScreen,
  Bin: BinScreen,
  Scratchpad: ScratchpadScreen,
  Editor: EditorScreen,
  ImportExport: ImportExportScreen,
  Settings: SettingsScreen,
  ProfileLock: ProfileLockScreen,
  About: AboutScreen,
  Privacy: PrivacyScreen,
};

// Wide windows get a navigation rail beside the screens that are top-level on the phone.
const destinations = [
  { name: 'Home', label: 'Notes', icon: 'note-text', outline: 'note-text-outline', covers: ['Home'] },
  { name: 'Tasks', label: 'Tasks', icon: 'checkbox-marked', outline: 'checkbox-marked-outline', covers: ['Tasks'] },
  { name: 'Scratchpad', label: 'Scratchpad', icon: 'notebook-edit', outline: 'notebook-edit-outline', covers: ['Scratchpad'] },
  { name: 'Settings', label: 'Settings', icon: 'cog', outline: 'cog-outline', covers: ['Settings', 'Bin', 'ImportExport', 'About', 'Privacy', 'ProfileLock'] },
];
const RAIL_MIN_WIDTH = 840;

const Rail = ({ route, nav }: { route: { name: string }; nav: { reset(state: { routes: { name: string }[] }): void } }) => {
  const { theme } = useTheme();
  return (
    <View style={{ width: 80, backgroundColor: theme.colors.background, borderRightWidth: 1, borderRightColor: theme.colors.outlineVariant, paddingTop: space.sm }}>
      <Drawer.Section showDivider={false}>
        {destinations.map(d => {
          const active = d.covers.includes(route.name);
          return (
            <Drawer.CollapsedItem
              key={d.name}
              label={d.label}
              focusedIcon={d.icon}
              unfocusedIcon={d.outline}
              active={active}
              onPress={() => nav.reset({ routes: [{ name: d.name }] })}
              accessibilityLabel={d.label}
            />
          );
        })}
      </Drawer.Section>
    </View>
  );
};

const frame = (width: number) => (content: React.ReactNode, nav: any, route: { name: string }) =>
  width >= RAIL_MIN_WIDTH && destinations.some(d => d.covers.includes(route.name)) ? (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Rail route={route} nav={nav} />
      <View style={{ flex: 1 }}>{content}</View>
    </View>
  ) : (
    <View style={{ flex: 1 }}>{content}</View>
  );

// A slim bar above every screen: the round logo and name, and (desktop window only) the web view switch.
const TopBar = () => {
  const { theme } = useTheme();
  const [web, setWeb] = useState<WebStatus | null>(null);
  useEffect(() => { if (isDesktop) invoke<WebStatus>('web:status').then(setWeb).catch(() => {}); }, []);
  const toggle = () =>
    invoke<WebStatus>(web?.on ? 'web:stop' : 'web:start').then(w => { setWeb(w); window.notespark?.refreshTray(); }, e => console.error(e));
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: space.md, backgroundColor: theme.colors.background, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }}>
        <Image source={{ uri: logo }} accessibilityLabel="NoteSpark logo" style={{ width: 28, height: 28 }} />
        <Text variant="titleMedium" style={{ marginLeft: space.sm, flex: 1 }}>NoteSpark</Text>
        {isDesktop && (
          <IconButton icon={web?.on ? 'web-off' : 'web'} accessibilityLabel={web?.on ? 'Stop web view' : 'Start web view'} onPress={toggle} />
        )}
      </View>
      {web?.on && (
        <Banner visible actions={[{ label: 'Copy link', onPress: () => invoke('web:copy') }, { label: 'Stop', onPress: toggle }]}>
          Web view is on. Open this on a device on your network: {web.links.map(l => l.replace(/\?t=.*/, '')).join('  ')}. Anyone with the link can read and edit your notes.
        </Banner>
      )}
    </>
  );
};

// The profile's database couldn't be read (a key that is gone, a damaged file): try again, or erase it.
const UnreadableProfile = ({ profileName, onRetry, onErase }: { profileName: string; onRetry: () => void; onErase: () => Promise<void> }) => {
  const { theme } = useTheme();
  const alert = useAlert();
  const confirmErase = () =>
    alert('Erase this profile?', `To use NoteSpark again, ${profileName} and all its notes will be erased from this computer. Your other profiles stay as they are. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase profile', style: 'destructive', onPress: () => onErase().catch(() => alert("Couldn't erase the profile", 'Close NoteSpark and open it again, then try again.')) },
    ]);
  return (
    <View style={{ flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl, justifyContent: 'center' }}>
      <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>Couldn't open {profileName}</Text>
      <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: space.md }}>
        This profile's database couldn't be read. If NoteSpark's folder was moved or restored from a backup, a protected profile's key may be missing, because it is kept in your system's keyring. You can try again, or erase this profile to use NoteSpark.
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl, flexWrap: 'wrap' }}>
        <Button mode="contained" onPress={onRetry}>Try again</Button>
        <Button mode="outlined" textColor={theme.colors.error} onPress={confirmErase}>Erase profile</Button>
      </View>
    </View>
  );
};

type LockState = { phase: 'starting' | 'ready' | 'locked' | 'unreadable'; profile: { id: string; name: string } | null };

const Shell = () => {
  const { theme, themeType } = useTheme();
  const { width } = useWindowDimensions();
  const [lock, setLock] = useState<LockState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const opened = useRef(false); // once the notes have been open, a lock covers them instead of replacing them

  const refresh = useCallback(() => {
    invoke<LockState>('lock:status').then(s => { setError(null); setLock(s); }, e => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    refresh();
    invoke<string | null>('settings', { op: 'get', key: 'onboarded' }).then(v => setOnboarding(v !== 'true'), () => setOnboarding(false));
    // Re-check whenever the window comes back, a call finds the profile locked, or the app locks it.
    window.addEventListener('focus', refresh);
    window.addEventListener('notespark-lock', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.notespark?.onLockChanged(refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('notespark-lock', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);
  // Native window colors (scrollbars, dialogs) follow the choice; only the desktop window owns that.
  useEffect(() => { if (isDesktop) invoke('theme:set', themeType); }, [themeType]);
  if (lock?.phase === 'ready') opened.current = true;

  const unlock = async (pin: string) => {
    const ok = await invoke<boolean>('lock:unlock', { pin });
    if (ok) refresh();
    return ok;
  };
  const erase = async () => { await invoke('lock:erase'); refresh(); };
  const unlockScreen = lock?.profile && (
    <ProfileUnlockScreen profileId={lock.profile.id} profileName={lock.profile.name} onUnlock={unlock} onForgotPin={erase} />
  );
  const finishOnboarding = () => { invoke('settings', { op: 'set', key: 'onboarded', value: 'true' }).catch(() => {}); setOnboarding(false); };

  let body: React.ReactNode;
  if (error) {
    body = (
      <View style={{ flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl, justifyContent: 'center' }}>
        <Text variant="headlineSmall">Couldn't open your notes</Text>
        <Text variant="bodyLarge" style={{ marginTop: space.md }}>{error.replace(/^Error invoking remote method 'backend': Error: /, '')}</Text>
        <Button mode="contained" onPress={refresh} style={{ alignSelf: 'flex-start', marginTop: space.xl }}>Try again</Button>
      </View>
    );
  } else if (!lock || onboarding === null) {
    body = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;
  } else if (lock.phase === 'unreadable' && lock.profile) {
    body = <UnreadableProfile profileName={lock.profile.name} onRetry={() => invoke('lock:retry').then(refresh)} onErase={erase} />;
  } else if (lock.phase === 'locked' && !opened.current) {
    body = unlockScreen;
  } else if (onboarding) {
    body = <OnboardingScreen onFinish={finishOnboarding} />;
  } else {
    body = (
      <>
        <Navigator initial="Home" screens={screens} frame={frame(width)} />
        {lock.phase === 'locked' && <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}>{unlockScreen}</View>}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PaperProvider theme={theme}>
        <DialogProvider>
          <TopBar />
          <View style={{ flex: 1 }}>{body}</View>
        </DialogProvider>
      </PaperProvider>
    </View>
  );
};

createRoot(document.getElementById('root')!).render(
  <SafeAreaProvider><ThemeProvider><Shell /></ThemeProvider></SafeAreaProvider>,
);
