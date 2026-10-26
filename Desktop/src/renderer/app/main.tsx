import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ActivityIndicator, Banner, Button, Icon, IconButton, PaperProvider, Text, Tooltip as PaperTooltip, TooltipProps } from 'react-native-paper';
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

// The places the phone's header links to, in the same order, plus Notes (Home) since a computer has no back stack to
// fall back on. They live in the top bar only: nothing else on screen repeats them.
const destinations = [
  { name: 'Home', label: 'Notes', icon: 'note-text', outline: 'note-text-outline', covers: ['Home', 'NoteView', 'Editor'] },
  { name: 'Scratchpad', label: 'Scratchpad', icon: 'notebook-edit', outline: 'notebook-edit-outline', covers: ['Scratchpad'] },
  { name: 'Tasks', label: 'Tasks', icon: 'checkbox-marked', outline: 'checkbox-marked-outline', covers: ['Tasks'] },
  { name: 'Settings', label: 'Settings', icon: 'cog', outline: 'cog-outline', covers: ['Settings', 'Bin', 'ImportExport', 'About', 'Privacy', 'ProfileLock'] },
];
// Like the phone: a place opens on top of Home, so Back returns to the notes.
const goTo = (nav: { reset(state: { routes: { name: string }[] }): void }, name: string) =>
  nav.reset({ routes: name === 'Home' ? [{ name }] : [{ name: 'Home' }, { name }] });

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

// The header: logo and name, the places, and (desktop window only) the web view switch, on one row that is also the
// window's title bar (drag it to move the window). It sits on a tonal surface so the screen's own title row below reads
// as the page, not as a second bar. Each place is a labelled pill (icon only in a narrow window); the current one is
// filled in the secondary container with a solid icon, and its tooltip carries the shortcut.
const TopBar = () => {
  const { theme } = useTheme();
  const here = useCurrentNavigation();
  const room = useWindowButtons();
  const { width } = useWindowDimensions();
  const [web, setWeb] = useState<WebStatus | null>(null);
  useEffect(() => { if (isDesktop) invoke<WebStatus>('web:status').then(setWeb).catch(() => {}); }, []);
  const toggle = () =>
    invoke<WebStatus>(web?.on ? 'web:stop' : 'web:start').then(w => { setWeb(w); window.notespark?.refreshTray(); }, e => console.error(e));
  const tip = { enterTouchDelay: 250, leaveTouchDelay: 150 };
  const quiet = theme.colors.onSurfaceVariant;
  const mod = /Mac/.test(navigator.platform) ? '\u2318' : 'Ctrl+';
  const showName = width >= 760;
  const showLabels = width >= 600;
  return (
    <>
      <View dataSet={{ drag: '' }} style={{ height: 64, flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg + room.left, paddingRight: space.sm + room.right, backgroundColor: theme.colors.surfaceContainerLow }}>
        <Image source={{ uri: logo }} accessibilityLabel="NoteSpark logo" style={{ width: 36, height: 36 }} />
        {showName && <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginLeft: space.md }}>NoteSpark</Text>}
        <View dataSet={{ nodrag: '' }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: showName ? space.xl : space.lg }}>
          {here && destinations.map((d, i) => {
            const active = d.covers.includes(here.route.name);
            return (
              <Tooltip key={d.name} title={`${d.label}  ${mod}${i + 1}`} {...tip}>
                <Pressable accessibilityRole="button" accessibilityLabel={d.label} accessibilityState={{ selected: active }} aria-current={active ? 'page' : undefined} onPress={() => goTo(here.nav, d.name)}
                  style={({ hovered, pressed }: any) => ({
                    height: 40, minWidth: 40, paddingHorizontal: showLabels || active ? space.lg : 0, borderRadius: shape.full,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
                    backgroundColor: active ? theme.colors.secondaryContainer : hovered || pressed ? theme.colors.surfaceContainerHighest : 'transparent',
                  })}>
                  <Icon source={active ? d.icon : d.outline} size={20} color={active ? theme.colors.onSecondaryContainer : quiet} />
                  {(showLabels || active) && <Text variant="labelLarge" style={{ color: active ? theme.colors.onSecondaryContainer : quiet }}>{d.label}</Text>}
                </Pressable>
              </Tooltip>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        {isDesktop && (
          <View dataSet={{ nodrag: '' }}>
            <Tooltip title={web?.on ? 'Stop web view' : 'Start web view'} {...tip}>
              {web?.on ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Stop web view" onPress={toggle}
                  style={({ hovered }: any) => ({ height: 40, paddingHorizontal: space.lg, borderRadius: shape.full, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: theme.colors.tertiaryContainer, opacity: hovered ? 0.9 : 1 })}>
                  <Icon source="web" size={20} color={theme.colors.onTertiaryContainer} />
                  <Text variant="labelLarge" style={{ color: theme.colors.onTertiaryContainer }}>Web view on</Text>
                </Pressable>
              ) : (
                <IconButton icon="web" size={22} iconColor={quiet} accessibilityLabel="Start web view" onPress={toggle} style={{ margin: 0, width: 40, height: 40 }} />
              )}
            </Tooltip>
          </View>
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
