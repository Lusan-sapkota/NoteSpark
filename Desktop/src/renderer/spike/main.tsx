import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FlatList, Image, View } from 'react-native';
import { PaperProvider, Appbar, Searchbar } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context'; // stubbed in the Vite config
import { Note } from '@notespark/core';
// The phone's real components and theme, imported straight from Mobile/.
import { ThemeProvider, useTheme } from '../../../../Mobile/src/theme/ThemeContext';
import { readingWidth } from '../../../../Mobile/src/theme/theme';
import { useHeaderElevation } from '../../../../Mobile/src/components/Header';
import logo from './round.png';
import NoteItem from '../../../../Mobile/src/components/NoteItem';

declare global {
  interface Window { notespark: { listNotes(): Promise<Note[]>; getTheme(): Promise<string>; setTheme(m: 'light' | 'dark' | 'system'): Promise<void> } }
}

const NotesList = () => {
  const { theme, themeType, setThemeType } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState('');
  const [loadMs, setLoadMs] = useState(0);
  useEffect(() => {
    const t = performance.now();
    window.notespark.listNotes().then(n => { setNotes(n); setLoadMs(performance.now() - t); });
  }, []);
  const q = query.trim().toLowerCase();
  const shown = q ? notes.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) : notes;
  const next = themeType === 'light' ? 'dark' : themeType === 'dark' ? 'system' : 'light';
  const noop = () => {};
  return (
    <PaperProvider theme={theme}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Appbar.Header mode="small" elevated={elevated}>
          <Image source={{ uri: logo }} accessibilityLabel="NoteSpark" style={{ width: 32, height: 32, marginLeft: 12, marginRight: 4 }} />
          <Appbar.Content title={`NoteSpark (${shown.length} of ${notes.length}, ${loadMs.toFixed(0)} ms)`} />
          <Appbar.Action icon="theme-light-dark" accessibilityLabel={`Theme: ${themeType}, switch to ${next}`} onPress={() => { setThemeType(next); window.notespark.setTheme(next); }} />
        </Appbar.Header>
        <View style={{ width: '100%', maxWidth: readingWidth, alignSelf: 'center', flex: 1 }}>
          <Searchbar placeholder="Search notes" value={query} onChangeText={setQuery} style={{ marginHorizontal: 16, marginVertical: 8 }} />
          <FlatList
            data={shown}
            keyExtractor={n => String(n.id)}
            onScroll={onScroll}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            renderItem={({ item, index }) => (
              <NoteItem note={item} isPinned={item.isPinned} isFirst={index === 0 || shown[index - 1].isPinned !== item.isPinned}
                isLast={index === shown.length - 1 || shown[index + 1].isPinned !== item.isPinned}
                onPress={noop} onDelete={noop} onEdit={noop} onPinToggle={noop} onArchiveToggle={noop} onSelect={noop} />
            )}
          />
        </View>
      </View>
    </PaperProvider>
  );
};

createRoot(document.getElementById('root')!).render(
  <SafeAreaProvider><ThemeProvider><NotesList /></ThemeProvider></SafeAreaProvider>,
);
