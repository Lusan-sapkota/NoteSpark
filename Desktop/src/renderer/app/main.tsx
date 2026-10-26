import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { ActivityIndicator, Button, PaperProvider, Text } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { invoke, isDesktop } from './bridge';
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
import ScratchpadScreen from '../../../../Mobile/src/screens/ScratchpadScreen';

// Screens that come in later steps show where they are headed instead of failing.
const comingLater = (title: string, when: string, openBin = false) => () => {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header title={title} showBackButton onBackPress={() => navigation.goBack()} />
      <View style={{ width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl }}>
        <Text variant="bodyLarge">{title} comes to the desktop app {when}. Until then, use the phone.</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
          <Button mode="contained" onPress={() => navigation.goBack()}>Go back</Button>
          {/* ponytail: the phone reaches the bin from Settings; until Settings is ported this is the only way in. */}
          {openBin && <Button mode="outlined" onPress={() => navigation.navigate('Bin')}>Open bin</Button>}
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
  Editor: comingLater('Editor', 'in the next step'),
  ImportExport: comingLater('Import and export', 'in the next step'),
  Settings: comingLater('Settings', 'in a later step', true),
  ProfileLock: comingLater('Profile lock', 'in a later step'),
  About: comingLater('About', 'in a later step'),
  Privacy: comingLater('Privacy', 'in a later step'),
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
          {state === 'ready' ? (
            <Navigator initial="Home" screens={screens} />
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
