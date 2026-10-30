import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ActivityIndicator, Button, Icon, IconButton, PaperProvider, Text, } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, useI18n } from '../../../../mobile/src/i18n/I18nContext';
import { invoke, isDesktop, WebStatus } from './bridge';
import logo from './round.png';
import Tip from './Tip';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { canShowMenuButton, MENU_BUTTON_CHANGED } from './KeepInTrayRow';
import { Navigator, useCurrentNavigation } from './nav';
import { setMeaningSearchAvailable } from './overrides/storage/semanticSearch';
// The phone's real screens, theme and shared components, imported straight from mobile/.
import { ThemeProvider, useTheme } from '../../../../mobile/src/theme/ThemeContext';
import { readingWidth, shape, space } from '../../../../mobile/src/theme/theme';
import { DialogProvider, useAlert } from '../../../../mobile/src/components/DialogProvider';
import { getStartScreen, StartScreen, startRoutes } from '../../../../mobile/src/utils/startScreen';
import LandscapeScreen from '../../../../mobile/src/screens/LandscapeScreen';
import ReviewScreen from '../../../../mobile/src/screens/ReviewScreen';
import TidyScreen from '../../../../mobile/src/screens/TidyScreen';
import AskScreen from '../../../../mobile/src/screens/AskScreen';
import HomeScreen from '../../../../mobile/src/screens/HomeScreen';
import NoteViewScreen from '../../../../mobile/src/screens/NoteViewScreen';
import TasksScreen from '../../../../mobile/src/screens/TasksScreen';
import BinScreen from '../../../../mobile/src/screens/BinScreen';
import EditorScreen from '../../../../mobile/src/screens/EditorScreen';
import ImportExportScreen from '../../../../mobile/src/screens/ImportExportScreen';
import ScratchpadScreen from '../../../../mobile/src/screens/ScratchpadScreen';
import SettingsScreen from '../../../../mobile/src/screens/SettingsScreen';
import ProfileLockScreen from '../../../../mobile/src/screens/ProfileLockScreen';
import ProfileUnlockScreen from '../../../../mobile/src/screens/ProfileUnlockScreen';
import AboutScreen from '../../../../mobile/src/screens/AboutScreen';
import PrivacyScreen from '../../../../mobile/src/screens/PrivacyScreen';
import SyncScreen from './SyncScreen';
import OnboardingScreen from '../../../../mobile/src/screens/OnboardingScreen';

const screens = {
  Home: HomeScreen,
  NoteView: NoteViewScreen,
  Tasks: TasksScreen,
  Bin: BinScreen,
  Ask: AskScreen,
  Tidy: TidyScreen,
  Landscape: LandscapeScreen,
  Review: ReviewScreen,
  Scratchpad: ScratchpadScreen,
  Editor: EditorScreen,
  ImportExport: ImportExportScreen,
  Settings: SettingsScreen,
  ProfileLock: ProfileLockScreen,
  About: AboutScreen,
  Privacy: PrivacyScreen,
  Sync: SyncScreen,
};


// Custom minimise, maximise and close buttons for the frameless window; closing is red on hover.
const WindowButtons = () => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    window.notespark?.windowControl('state').then(state => state && setMaximized(state.maximized), () => {});
    window.notespark?.onWindowState(state => setMaximized(state.maximized));
  }, []);
  const buttons = [
    { action: 'minimize', label: t('desktop.minimize'), icon: 'window-minimize' },
    { action: 'maximize', label: maximized ? t('common.restore') : t('desktop.maximize'), icon: maximized ? 'window-restore' : 'window-maximize' },
    { action: 'close', label: t('common.close'), icon: 'window-close' },
  ] as const;
  return (
    <View dataSet={{ nodrag: '' }} style={{ flexDirection: 'row', alignSelf: 'stretch', marginLeft: space.sm }}>
      {buttons.map(b => (
        <Pressable key={b.action} accessibilityRole="button" accessibilityLabel={b.label} onPress={() => { void window.notespark?.windowControl(b.action); }}
          style={({ hovered, pressed }: any) => ({ width: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered || pressed ? (b.action === 'close' ? theme.colors.error : theme.colors.surfaceContainerHighest) : 'transparent' })}>
          {({ hovered, pressed }: any) => <Icon source={b.icon} size={18} color={(hovered || pressed) && b.action === 'close' ? theme.colors.onError : theme.colors.onSurface} />}
        </Pressable>
      ))}
    </View>
  );
};

// The header row is the desktop window's title bar: logo, name, the web view switch and window buttons.
const TopBar = () => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [web, setWeb] = useState<WebStatus | null>(null);
  useEffect(() => { if (isDesktop) invoke<WebStatus>('web:status').then(setWeb).catch(() => {}); }, []);
  const [open, setOpen] = useState(false); // the details panel under the chip
  // Starting copies the link and says so for two seconds; the chip opens the details.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const hide = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(hide);
  }, [copied]);
  const toggle = () => {
    const starting = !web?.on;
    invoke<WebStatus>(starting ? 'web:start' : 'web:stop').then(async w => {
      setWeb(w);
      setOpen(false);
      window.notespark?.refreshTray();
      if (starting && w.on) setCopied(await invoke('web:copy').then(() => true, () => false));
    }, e => console.error(e));
  };
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  // The panel eases in and out (none with reduced motion) and stays mounted until the close transition ends.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const visible = !!web?.on && open;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const start = setTimeout(() => setShown(true), 30); // after the first paint, so the change is animated
      return () => clearTimeout(start);
    }
    setShown(false);
    const done = setTimeout(() => setMounted(false), reduce ? 0 : 220);
    return () => clearTimeout(done);
  }, [visible]);
  const tip = { enterTouchDelay: 250, leaveTouchDelay: 150 };
  const quiet = theme.colors.onSurfaceVariant;
  const showName = width >= 760;
  // Not on macOS, whose menu bar covers it; elsewhere a global menu may be missing (Wayland, Windows' hidden title bar). Settings can hide it.
  const [menuSetting, setMenuSetting] = useState(true);
  useEffect(() => {
    const read = () => AsyncStorage.getItem('menuButton').then(value => setMenuSetting(value !== 'false'), () => {});
    read();
    window.addEventListener(MENU_BUTTON_CHANGED, read);
    return () => window.removeEventListener(MENU_BUTTON_CHANGED, read);
  }, []);
  const showMenu = canShowMenuButton && menuSetting;
  return (
    <View style={{ zIndex: 20 }}>
      <View dataSet={{ drag: '' }} style={{ height: 48, flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: isDesktop ? 0 : space.sm, backgroundColor: theme.colors.surfaceContainerLow }}>
        {showMenu && (
          <View dataSet={{ nodrag: '' }} style={{ marginLeft: -space.sm, marginRight: space.xs }}>
            <Tip title={t('desktop.menu')} {...tip}>
              <IconButton icon="menu" size={22} iconColor={quiet} accessibilityLabel={t('desktop.menu')} style={{ margin: 0, width: 36, height: 36 }}
                onPress={(e: any) => {
                  const r = e?.currentTarget?.getBoundingClientRect?.();
                  void window.notespark?.popupMenu(r?.left ?? 0, r?.bottom ?? 40);
                }} />
            </Tip>
          </View>
        )}
        <Image source={{ uri: logo }} accessibilityLabel={t('desktop.logoLabel')} style={{ width: 28, height: 28 }} />
        {showName && <Text variant="titleMedium" style={{ color: theme.colors.onSurface, marginLeft: space.md }}>NoteSpark</Text>}
        <View style={{ flex: 1 }} />
        {isDesktop && (
          <View dataSet={{ nodrag: '' }}>
            <Tip title={web?.on ? (open ? t('desktop.hideWebDetails') : t('desktop.showWebDetails')) : t('desktop.startWebView')} {...tip}>
              {web?.on ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('desktop.webDetails')} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
                  style={({ hovered }: any) => ({ height: 32, paddingLeft: space.md, paddingRight: space.sm, borderRadius: shape.control, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: theme.colors.tertiaryContainer, opacity: hovered ? 0.9 : 1 })}>
                  <Icon source="web" size={20} color={theme.colors.onTertiaryContainer} />
                  <Text variant="labelLarge" style={{ color: theme.colors.onTertiaryContainer }}>{t('desktop.webViewOn')}</Text>
                  <Icon source={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.onTertiaryContainer} />
                </Pressable>
              ) : (
                <IconButton icon="web" size={22} iconColor={quiet} accessibilityLabel={t('desktop.startWebView')} onPress={toggle} style={{ margin: 0, width: 36, height: 36 }} />
              )}
            </Tip>
          </View>
        )}
        {isDesktop && <WindowButtons />}
      </View>
      {copied && (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ position: 'absolute', top: 52, right: space.lg, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: shape.control, backgroundColor: theme.colors.inverseSurface }}>
          <Text variant="bodySmall" style={{ color: theme.colors.inverseOnSurface }}>{t('desktop.linkCopied')}</Text>
        </View>
      )}
      {mounted && (
        <>
          {/* Clicking anywhere else closes the panel; the top bar stays clickable above it. */}
          <Pressable accessibilityLabel={t('desktop.closeWebDetails')} onPress={() => setOpen(false)} style={{ position: 'fixed' as any, top: 48, left: 0, right: 0, bottom: 0 }} />
          <View dataSet={{ nodrag: '' }} style={{
            position: 'absolute', top: 52, right: space.lg, width: 360, maxWidth: '92%', padding: space.lg, gap: space.md, borderRadius: shape.group, backgroundColor: theme.colors.surfaceContainerHigh,
            opacity: shown ? 1 : 0,
            transform: [{ translateY: shown ? 0 : -8 }, { scale: shown ? 1 : 0.97 }],
            transformOrigin: 'top right',
            transitionProperty: 'opacity, transform', transitionDuration: reduce ? '0ms' : '220ms', transitionTimingFunction: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
          } as any}>
            <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>{t('desktop.webViewIsOn')}</Text>
            <View style={{ gap: space.xs }}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('desktop.openLinks')}</Text>
              {web?.links.map(l => <Text key={l} variant="bodyMedium" selectable style={{ color: theme.colors.onSurface }}>{l.replace(/\?t=.*/, '')}</Text>)}
            </View>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('desktop.anyoneWithLink')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>
              <Button mode="text" onPress={toggle}>{t('desktop.stopWebView')}</Button>
              <Button mode="contained-tonal" onPress={() => invoke('web:copy')}>{t('desktop.copyLink')}</Button>
            </View>
          </View>
        </>
      )}
    </View>
  );
};

// The profile's database couldn't be read (a key that is gone, a damaged file): try again, or erase it.
const UnreadableProfile = ({ profileName, onRetry, onErase }: { profileName: string; onRetry: () => void; onErase: () => Promise<void> }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const alert = useAlert();
  const confirmErase = () =>
    alert(t('desktop.eraseTitle'), t('desktop.eraseMessage', { name: profileName }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('desktop.eraseProfile'), style: 'destructive', onPress: () => onErase().catch(() => alert(t('desktop.eraseFailedTitle'), t('desktop.eraseFailedMessage'))) },
    ]);
  return (
    <View style={{ flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl, justifyContent: 'center' }}>
      <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>{t('desktop.unreadableTitle', { name: profileName })}</Text>
      <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: space.md }}>
        {t('desktop.unreadableMessage')}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl, flexWrap: 'wrap' }}>
        <Button mode="contained" onPress={onRetry}>{t('common.tryAgain')}</Button>
        <Button mode="outlined" textColor={theme.colors.error} onPress={confirmErase}>{t('desktop.eraseProfile')}</Button>
      </View>
    </View>
  );
};

type LockState = { phase: 'starting' | 'ready' | 'locked' | 'unreadable'; profile: { id: string; name: string } | null };

const Shell = () => {
  const { theme, themeType, setThemeType } = useTheme();
  const { t, language } = useI18n();
  // The tray menu and application menu are built in the main process: rebuild them when the language changes (not at start).
  const languageSeen = useRef(language);
  useEffect(() => {
    if (languageSeen.current === language) return;
    languageSeen.current = language;
    window.notespark?.refreshTray().catch(() => {});
  }, [language]);
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
  // Back without the arrow: Alt+Left, or the mouse's back button (the arrow sits at the top left of each screen).
  useEffect(() => {
    const back = () => { if (here?.nav.canGoBack()) here.nav.goBack(); };
    const key = (e: KeyboardEvent) => { if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); } };
    const mouse = (e: MouseEvent) => { if (e.button === 3) { e.preventDefault(); back(); } };
    window.addEventListener('keydown', key);
    window.addEventListener('mouseup', mouse);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mouseup', mouse); };
  }, [here]);
  const [lock, setLock] = useState<LockState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const [searchKnown, setSearchKnown] = useState(false); // Home reads the answer when it first draws
  const [startScreen, setStartScreen] = useState<StartScreen | null>(null);
  const opened = useRef(false); // once the notes have been open, a lock covers them instead of replacing them

  const refresh = useCallback(() => {
    invoke<LockState>('lock:status').then(s => { setError(null); setLock(s); }, e => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    refresh();
    invoke<boolean>('search:available').then(setMeaningSearchAvailable, () => setMeaningSearchAvailable(false)).finally(() => setSearchKnown(true));
    getStartScreen().then(setStartScreen);
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
        <Text variant="headlineSmall">{t('desktop.openFailedTitle')}</Text>
        <Text variant="bodyLarge" style={{ marginTop: space.md }}>{error.replace(/^Error invoking remote method 'backend': Error: /, '')}</Text>
        <Button mode="contained" onPress={refresh} style={{ alignSelf: 'flex-start', marginTop: space.xl }}>{t('common.tryAgain')}</Button>
      </View>
    );
  } else if (!lock || onboarding === null || !searchKnown || !startScreen) {
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
        <Navigator initial={startRoutes(startScreen)} screens={screens} />
        {lock.phase === 'locked' && <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}>{unlockScreen}</View>}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PaperProvider theme={theme}>
        <DialogProvider>
          {/* In a browser the tab shows the name and icon, and every screen has its own app bar. */}
          {isDesktop && <TopBar />}
          <View style={{ flex: 1 }}>{body}</View>
        </DialogProvider>
      </PaperProvider>
    </View>
  );
};

createRoot(document.getElementById('root')!).render(
  <SafeAreaProvider><ThemeProvider><I18nProvider><Shell /></I18nProvider></ThemeProvider></SafeAreaProvider>,
);
