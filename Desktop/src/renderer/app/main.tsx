import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, Pressable, StyleSheet, View } from 'react-native';
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

// The header: logo, the places, and (desktop window only) the web view switch, on one row that is also the window's
// title bar (drag it to move the window). The current place sits in a tonal pill with a filled icon; every place has a tooltip. Screens keep their own title row below, on the same background, so the two read as one header.
const TopBar = () => {
  const { theme } = useTheme();
  const here = useCurrentNavigation();
  const room = useWindowButtons();
  const [web, setWeb] = useState<WebStatus | null>(null);
  useEffect(() => { if (isDesktop) invoke<WebStatus>('web:status').then(setWeb).catch(() => {}); }, []);
  const toggle = () =>
    invoke<WebStatus>(web?.on ? 'web:stop' : 'web:start').then(w => { setWeb(w); window.notespark?.refreshTray(); }, e => console.error(e));
  const tip = { enterTouchDelay: 250, leaveTouchDelay: 150 };
  const quiet = theme.colors.onSurfaceVariant;
  return (
    <>
      <View dataSet={{ drag: '' }} style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg + room.left, paddingRight: space.sm + room.right, backgroundColor: theme.colors.background }}>
        <Image source={{ uri: logo }} accessibilityLabel="NoteSpark logo" style={{ width: 32, height: 32, marginRight: space.lg }} />
        <View dataSet={{ nodrag: '' }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {here && destinations.map(d => {
            const active = d.covers.includes(here.route.name);
            // Material's navigation indicator: a 56 by 32 pill behind the icon marks where you are, so the row never
            // shifts as you move; the name is in the tooltip, and in the title row of the screen below.
            return (
              <Tooltip key={d.name} title={d.label} {...tip}>
                <Pressable accessibilityRole="button" accessibilityLabel={d.label} accessibilityState={{ selected: active }} aria-current={active ? "page" : undefined} hitSlop={{ top: 4, bottom: 4 }} onPress={() => goTo(here.nav, d.name)}
                  style={{ width: 56, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 56, height: 32, borderRadius: shape.full, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.colors.secondaryContainer : 'transparent' }}>
                    <Icon source={active ? d.icon : d.outline} size={24} color={active ? theme.colors.onSecondaryContainer : quiet} />
                  </View>
                </Pressable>
              </Tooltip>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        {isDesktop && (
          <View dataSet={{ nodrag: '' }}>
            <Tooltip title={web?.on ? 'Stop web view' : 'Start web view'} {...tip}>
              <IconButton icon={web?.on ? 'web-off' : 'web'} size={22} mode={web?.on ? 'contained' : undefined} selected={!!web?.on}
                iconColor={web?.on ? theme.colors.onPrimary : quiet} containerColor={web?.on ? theme.colors.primary : undefined}
                accessibilityLabel={web?.on ? 'Stop web view' : 'Start web view'} onPress={toggle} style={{ margin: 0, width: 40, height: 40 }} />
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
