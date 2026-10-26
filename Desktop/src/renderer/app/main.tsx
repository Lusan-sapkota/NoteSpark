import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, View } from 'react-native';
import { ActivityIndicator, Banner, Button, IconButton, PaperProvider, Text } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { invoke, isDesktop, WebStatus } from './bridge';
import logo from './round.png';
import { Navigator, useNavigation } from './nav';
// The phone's real screens, theme and shared components, imported straight from Mobile/.
import { ThemeProvider, useTheme } from '../../../../Mobile/src/theme/ThemeContext';
import { readingWidth, space } from '../../../../Mobile/src/theme/theme';
import Header from '../../../../Mobile/src/components/Header';
import { DialogProvider } from '../../../../Mobile/src/components/DialogProvider';
import HomeScreen from '../../../../Mobile/src/screens/HomeScreen';
import NoteViewScreen from '../../../../Mobile/src/screens/NoteViewScreen';
import TasksScreen from '../../../../Mobile/src/screens/TasksScreen';
import BinScreen from '../../../../Mobile/src/screens/BinScreen';
import EditorScreen from '../../../../Mobile/src/screens/EditorScreen';
import ImportExportScreen from '../../../../Mobile/src/screens/ImportExportScreen';
import ScratchpadScreen from '../../../../Mobile/src/screens/ScratchpadScreen';

// Screens that come in later steps show where they are headed instead of failing.
const comingLater = (title: string, when: string, links: [string, string][] = []) => () => {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header title={title} showBackButton onBackPress={() => navigation.goBack()} />
      <View style={{ width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl }}>
        <Text variant="bodyLarge">{title} comes to the desktop app {when}. Until then, use the phone.</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
          <Button mode="contained" onPress={() => navigation.goBack()}>Go back</Button>
          {/* ponytail: the phone reaches these from Settings; until Settings is ported these are the only way in. */}
          {links.map(([label, to]) => <Button key={to} mode="outlined" onPress={() => navigation.navigate(to)}>{label}</Button>)}
        </View>
      </View>
    </View>
  );
};

const screens = {
  Home: HomeScreen,
  NoteView: NoteViewScreen,
  Tasks: TasksScreen,
  Bin: BinScreen,
  Scratchpad: ScratchpadScreen,
  Editor: EditorScreen,
  ImportExport: ImportExportScreen,
  Settings: comingLater('Settings', 'in a later step', [['Open bin', 'Bin'], ['Import and export', 'ImportExport']]),
  ProfileLock: comingLater('Profile lock', 'in a later step'),
  About: comingLater('About', 'in a later step'),
  Privacy: comingLater('Privacy', 'in a later step'),
};

// A slim bar above every screen: the round logo and name, and (desktop window only) the web view switch.
const TopBar = () => {
  const { theme } = useTheme();
  const [web, setWeb] = useState<WebStatus | null>(null);
  useEffect(() => { if (isDesktop) invoke<WebStatus>('web:status').then(setWeb); }, []);
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

const Shell = () => {
  const { theme, themeType } = useTheme();
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  const open = () => {
    setState('loading');
    // Opens the default profile the way the phone does at start.
    invoke('storage', { module: 'profiles', fn: 'getActiveProfile' }).then(() => setState('ready'), e => setState({ error: String(e.message ?? e).replace(/^Error invoking remote method 'backend': Error: /, '') }));
  };
  useEffect(open, []);
  // Native window colors (scrollbars, dialogs) follow the choice; only the desktop window owns that.
  useEffect(() => { if (isDesktop) invoke('theme:set', themeType); }, [themeType]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <PaperProvider theme={theme}>
        <DialogProvider>
          <TopBar />
          {state === 'ready' ? (
            <View style={{ flex: 1 }}><Navigator initial="Home" screens={screens} /></View>
          ) : state === 'loading' ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" /></View>
          ) : (
            <View style={{ flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl, justifyContent: 'center' }}>
              <Text variant="headlineSmall">Couldn't open your notes</Text>
              <Text variant="bodyLarge" style={{ marginTop: space.md }}>{state.error}</Text>
              <Button mode="contained" onPress={open} style={{ alignSelf: 'flex-start', marginTop: space.xl }}>Try again</Button>
            </View>
          )}
        </DialogProvider>
      </PaperProvider>
    </View>
  );
};

createRoot(document.getElementById('root')!).render(
  <SafeAreaProvider><ThemeProvider><Shell /></ThemeProvider></SafeAreaProvider>,
);
