import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ActivityIndicator, Button, Icon, IconButton, PaperProvider, Text, Tooltip as PaperTooltip, TooltipProps } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { invoke, isDesktop, WebStatus } from './bridge';
import logo from './round.png';
import { Navigator, useCurrentNavigation } from './nav';
import { setMeaningSearchAvailable } from './overrides/storage/semanticSearch';
// The phone's real screens, theme and shared components, imported straight from Mobile/.
import { ThemeProvider, useTheme } from '../../../../Mobile/src/theme/ThemeContext';
import { readingWidth, shape, space } from '../../../../Mobile/src/theme/theme';
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

// Paper draws tooltips in the inverse colors (a light bubble on a dark screen). This one sits on the app's own surfaces,
// like the phone's snackbar: a raised surface with the normal text color, in light and dark.
const Tooltip = (props: TooltipProps) => {
  const { theme } = useTheme();
  return <PaperTooltip {...props} theme={{ colors: { onSurface: theme.colors.surfaceContainerHighest, surface: theme.colors.onSurface } }} />;
};

// How much room the window's own buttons (minimise, maximise, close) take at each end of the header. The header is the
// title bar, so it leaves that room free; in a browser (the web view) there are no such buttons and the room is 0.
const useWindowButtons = () => {
  const [room, setRoom] = useState({ left: 0, right: 0 });
  useEffect(() => {
    const overlay = (navigator as any).windowControlsOverlay;
    if (!overlay?.visible) return;
    const measure = () => {
      const area = overlay.getTitlebarAreaRect();
      setRoom({ left: Math.round(area.x), right: Math.max(0, Math.round(window.innerWidth - area.x - area.width)) });
    };
    measure();
    overlay.addEventListener('geometrychange', measure);
    window.addEventListener('resize', measure);
    return () => { overlay.removeEventListener('geometrychange', measure); window.removeEventListener('resize', measure); };
  }, []);
  return room;
};

// The header: logo and name, and (desktop window only) the web view switch, on one row that is also the window's title
// bar (drag it to move the window). It sits on a tonal surface so the screen's own title row below reads as the page, not
// as a second bar. The places (Scratchpad, Tasks, Settings) are buttons in the Notes title row, as on the phone.
const TopBar = () => {
  const { theme } = useTheme();
  const room = useWindowButtons();
  const { width } = useWindowDimensions();
  const [web, setWeb] = useState<WebStatus | null>(null);
  useEffect(() => { if (isDesktop) invoke<WebStatus>('web:status').then(setWeb).catch(() => {}); }, []);
  const [open, setOpen] = useState(false); // the details panel under the chip
  const toggle = () =>
    invoke<WebStatus>(web?.on ? 'web:stop' : 'web:start').then(w => { setWeb(w); setOpen(!!w.on); window.notespark?.refreshTray(); }, e => console.error(e));
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  const tip = { enterTouchDelay: 250, leaveTouchDelay: 150 };
  const quiet = theme.colors.onSurfaceVariant;
  const showName = width >= 760;
  return (
    <View style={{ zIndex: 20 }}>
      <View dataSet={{ drag: '' }} style={{ height: 64, flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg + room.left, paddingRight: space.sm + room.right, backgroundColor: theme.colors.surfaceContainerLow }}>
        <Image source={{ uri: logo }} accessibilityLabel="NoteSpark logo" style={{ width: 36, height: 36 }} />
        {showName && <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginLeft: space.md }}>NoteSpark</Text>}
        <View style={{ flex: 1 }} />
        {isDesktop && (
          <View dataSet={{ nodrag: '' }}>
            <Tooltip title={web?.on ? (open ? 'Hide web view details' : 'Show web view details') : 'Start web view'} {...tip}>
              {web?.on ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Web view details" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
                  style={({ hovered }: any) => ({ height: 40, paddingLeft: space.lg, paddingRight: space.md, borderRadius: shape.full, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: theme.colors.tertiaryContainer, opacity: hovered ? 0.9 : 1 })}>
                  <Icon source="web" size={20} color={theme.colors.onTertiaryContainer} />
                  <Text variant="labelLarge" style={{ color: theme.colors.onTertiaryContainer }}>Web view on</Text>
                  <Icon source={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onTertiaryContainer} />
                </Pressable>
              ) : (
                <IconButton icon="web" size={22} iconColor={quiet} accessibilityLabel="Start web view" onPress={toggle} style={{ margin: 0, width: 40, height: 40 }} />
              )}
            </Tooltip>
          </View>
        )}
      </View>
      {web?.on && open && (
        <View dataSet={{ nodrag: '' }} style={{ position: 'absolute', top: 68, right: space.lg, width: 360, maxWidth: '92%', padding: space.lg, gap: space.md, borderRadius: shape.group, backgroundColor: theme.colors.surfaceContainerHigh }}>
          <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>Web view is on</Text>
          <View style={{ gap: space.xs }}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Open one of these in a browser on your network:</Text>
            {web.links.map(l => <Text key={l} variant="bodyMedium" selectable style={{ color: theme.colors.onSurface }}>{l.replace(/\?t=.*/, '')}</Text>)}
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Anyone with the link can read and edit your notes.</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>
            <Button mode="text" onPress={toggle}>Stop web view</Button>
            <Button mode="contained-tonal" onPress={() => invoke('web:copy')}>Copy link</Button>
          </View>
        </View>
      )}
    </View>
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
  const { theme, themeType, setThemeType } = useTheme();
  const here = useCurrentNavigation();
  // Actions from the application menu (open a place, change the appearance). Listening starts once the screens are there.
  const menuHandler = useRef<(action: any) => void>(() => {});
  menuHandler.current = action => {
    if (action.type === 'go') here?.nav.reset({ routes: (action.routes as string[]).map(name => ({ name })) });
    else if (action.type === 'theme') setThemeType(action.mode);
  };
  const listening = useRef(false);
  useEffect(() => {
    if (here && !listening.current && window.notespark?.onMenu) { listening.current = true; window.notespark.onMenu(action => menuHandler.current(action)); }
  }, [here]);
  const [lock, setLock] = useState<LockState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const [searchKnown, setSearchKnown] = useState(false); // Home reads the answer when it first draws
  const opened = useRef(false); // once the notes have been open, a lock covers them instead of replacing them

  const refresh = useCallback(() => {
    invoke<LockState>('lock:status').then(s => { setError(null); setLock(s); }, e => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    refresh();
    invoke<boolean>('search:available').then(setMeaningSearchAvailable, () => setMeaningSearchAvailable(false)).finally(() => setSearchKnown(true));
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
  } else if (!lock || onboarding === null || !searchKnown) {
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
        <Navigator initial="Home" screens={screens} />
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
