import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Share, Platform, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Icon, IconButton, Menu, RadioButton, Text, TextInput } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { exportNotesAsJson, getNotes } from '../storage/database';
import { sendAppNotification } from '../utils/notifications';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { importNotes, ImportMode } from '../storage/notes';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { groupCorners, lightTheme, readingWidth, shape, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type ImportExportScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportExport'>;

const ImportExportScreen: React.FC = () => {
  const navigation = useNavigation<ImportExportScreenNavigationProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const [importData, setImportData] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [fileImporting, setFileImporting] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [historyMenuVisible, setHistoryMenuVisible] = useState(false);
  const handleExportHistoryPDF = async () => {
    alert(
      'Export history as PDF?',
      'Creates a PDF of your import and export history that you can save or share.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {},
        },
        {
          text: 'Export PDF',
          onPress: async () => {
            setPdfExporting(true);
            try {
              // Printed on white, so the PDF uses the light scheme.
              const c = lightTheme.colors;
              let html = `<html><head><style>body{font-family:sans-serif;color:${c.onSurface};}h2{color:${c.primary};}table{width:100%;border-collapse:collapse;}th,td{border:1px solid ${c.outlineVariant};padding:8px;text-align:left;}th{background:${c.surfaceContainer};}tr:nth-child(even){background:${c.surfaceContainerLow};}</style></head><body>`;
              html += `<h2>NoteSpark import and export history</h2><table><tr><th>Date</th><th>Type</th><th>Count</th><th>Note</th></tr>`;
              history.forEach(h => {
                html += `<tr><td>${new Date(h.date).toLocaleString()}</td><td>${h.type}</td><td>${typeof h.count === 'number' ? h.count : 0}</td><td>${h.error && h.error.trim() ? h.error : 'No error'}</td></tr>`;
              });
              html += `</table></body></html>`;
              const Print = require('expo-print');
              const Sharing = require('expo-sharing');
              const { uri } = await Print.printToFileAsync({ html });
              await Sharing.shareAsync(uri);
            } catch (err) {
              alert("Couldn't create the PDF", 'Try again.');
            }
            setPdfExporting(false);
          },
        },
      ]
    );
  };

  const loadHistory = async () => {
    getNotes().then(notes => setNoteCount(notes.length)).catch(() => {});
    try {
      const raw = await AsyncStorage.getItem('notesHistory');
      console.log('Loaded notesHistory:', raw);
      setHistory(raw ? JSON.parse(raw) : []);
    } catch (e) {
      console.log('Error loading notesHistory:', e);
    }
  };
  React.useEffect(() => {
    loadHistory();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  };

  // Helper to add history event (always fetch latest from AsyncStorage to avoid stale state)
  const addHistory = async (event: any) => {
    try {
      const raw = await AsyncStorage.getItem('notesHistory');
      const prevHistory = raw ? JSON.parse(raw) : [];
      const newHistory = [event, ...prevHistory].slice(0, 20); // keep last 20
      setHistory(newHistory);
      await AsyncStorage.setItem('notesHistory', JSON.stringify(newHistory));
      console.log('Saved notesHistory:', JSON.stringify(newHistory));
    } catch (e) {
      console.log('Error saving notesHistory:', e);
    }
  };

  const clearHistory = async () => {
    alert(
      'Clear history?',
      'Your import and export history will be cleared. Your notes stay as they are.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {},
        },
        {
          text: 'Clear history',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem('notesHistory');
              setHistory([]);
              console.log('Cleared notesHistory');
            } catch (e) {
              console.log('Error clearing notesHistory:', e);
            }
          },
        },
      ]
    );
  };
  const { exportNotesToFile } = require('../storage/database');
  const handleExport = async () => {
    setIsExporting(true);
    let notesArr: any[] = [];
    try {
      let notesJson = await exportNotesAsJson();
      if (typeof notesJson === 'string') {
        try {
          notesArr = JSON.parse(notesJson);
        } catch {
          notesArr = [];
        }
      } else if (Array.isArray(notesJson)) {
        notesArr = notesJson;
      }
      notesArr = notesArr.map((note: any) => ({
        ...note,
        isMarkdown: typeof note.isMarkdown === 'boolean' ? note.isMarkdown : !!note.isMarkdown,
      }));
      const jsonString = JSON.stringify(notesArr, null, 2);

      const fileName = `notespark-export-${Date.now()}.json`;
      const fileUri = `${Platform.OS === 'android' ? '/storage/emulated/0/Download/' : ''}${fileName}`;

      let fileSaved = false;
      try {
        const FileSystem = require('expo-file-system');
        await FileSystem.writeAsStringAsync(fileUri, jsonString, { encoding: FileSystem.EncodingType.UTF8 });
        fileSaved = true;
      } catch (e) {
        fileSaved = false;
      }

      alert(
        'Export notes?',
        'Next, choose where to save or share the file.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: async () => {
              await addHistory({
                type: 'export',
                date: new Date().toISOString(),
                count: 0,
                error: 'Export cancelled by user.'
              });
              setIsExporting(false);
            }
          },
          {
            text: 'Continue',
            onPress: async () => {
              if (fileSaved) {
                await Share.share({
                  url: fileUri,
                  title: 'Exported Notes',
                  message: 'Exported notes from NoteSpark',
                });
                await sendAppNotification('Notes exported', `${notesArr.length} notes exported.`);
                await addHistory({
                  type: 'export',
                  date: new Date().toISOString(),
                  count: notesArr.length,
                  error: '',
                });
                alert('Notes exported', `${notesArr.length} notes exported.`, [
                  { text: 'OK' }
                ]);
              } else {
                if (jsonString.length > 50000) {
                  alert('Export is too large to share as text', 'Save the export with a file manager app instead.');
                  await addHistory({
                    type: 'export',
                    date: new Date().toISOString(),
                    count: 0,
                    error: 'Export too large to share as text.'
                  });
                } else {
                  await Share.share({
                    title: 'Exported Notes',
                    message: jsonString,
                  });
                  await sendAppNotification('Notes exported', `${notesArr.length} notes exported.`);
                  await addHistory({
                    type: 'export',
                    date: new Date().toISOString(),
                    count: notesArr.length,
                    error: '',
                  });
                  alert('Notes exported', `${notesArr.length} notes exported.`, [
                    { text: 'OK' }
                  ]);
                }
              }
              setIsExporting(false);
            }
          }
        ]
      );
    } catch (error) {
      console.error('Failed to export notes:', error);
      const errorMessage =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: string }).message)
          : 'Failed to export notes. Please try again.';
      alert("Couldn't export notes", errorMessage);
      await addHistory({
        type: 'export',
        date: new Date().toISOString(),
        count: 0,
        error: errorMessage,
      });
      setIsExporting(false);
    }
  };

  const logImport = (count: number, error: string) =>
    addHistory({ type: 'import', date: new Date().toISOString(), count, error });

  // Writes the notes with the chosen mode and reports the result. Returns the success message.
  const runImport = async (notes: any[], incomplete: number) => {
    const { imported, skipped } = await importNotes(notes, importMode);
    let msg = imported === 1 ? '1 note imported.' : `${imported} notes imported.`;
    if (skipped > 0) msg += ` ${skipped} already on this device, so skipped.`;
    if (incomplete > 0) msg += ` ${incomplete} incomplete notes skipped.`;
    await sendAppNotification('Notes imported', msg);
    const notesLine = [skipped > 0 && `${skipped} duplicates skipped.`, incomplete > 0 && `${incomplete} incomplete notes skipped.`].filter(Boolean).join(' ');
    await logImport(imported, imported === 0 ? 'All notes were already on this device.' : notesLine);
    await loadHistory();
    return msg;
  };

  // Only replacing deletes anything, so only replacing asks first.
  const confirmIfReplacing = (action: () => void) => {
    if (importMode !== 'replace') {
      action();
      return;
    }
    alert(
      'Replace all notes?',
      'Every note on this device will be deleted and replaced with the notes in the backup. Export your current notes first if you want to keep them.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => { logImport(0, 'Import cancelled.'); } },
        { text: 'Replace notes', style: 'destructive', onPress: action },
      ]
    );
  };

  const handleImport = () => {
    if (!importData.trim()) {
      alert('Paste your backup first', 'Paste the JSON from a NoteSpark export, or choose a file instead.');
      return;
    }
    confirmIfReplacing(async () => {
      try {
        setIsImporting(true);
        let parsed: any;
        try {
          parsed = JSON.parse(importData);
          if (!Array.isArray(parsed)) throw new Error('Not an array');
        } catch (e) {
          alert("That isn't valid JSON", 'Check that you pasted the whole export file.');
          await logImport(0, 'Invalid JSON format.');
          return;
        }
        const validNotes = parsed.filter((note: any) =>
          note && note.title && note.content && !isNaN(Date.parse(note.createdAt)) && !isNaN(Date.parse(note.updatedAt))
        ).map((note: any) => ({ ...note, isMarkdown: !!note.isMarkdown }));
        if (validNotes.length === 0) {
          alert('No notes found', "The backup doesn't contain any notes NoteSpark can read.");
          await logImport(0, 'No valid notes found.');
          return;
        }
        const msg = await runImport(validNotes, parsed.length - validNotes.length);
        setImportData('');
        setPasteOpen(false);
        alert('Notes imported', msg);
      } catch (error) {
        console.error('Failed to import notes:', error);
        alert("Couldn't import notes", 'Your existing notes are unchanged. Check that the data is a NoteSpark export.');
        await logImport(0, 'Import failed.');
      } finally {
        setIsImporting(false);
      }
    });
  };

  const handleFileImport = () => {
    confirmIfReplacing(async () => {
      try {
        setFileImporting(true);
        const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
        const uri = result.assets?.[0]?.uri;
        if (result.canceled || !uri) return;
        let parsed: any;
        try {
          parsed = JSON.parse(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 }));
          if (!Array.isArray(parsed)) throw new Error('Not an array');
        } catch (e) {
          alert("That file isn't a NoteSpark backup", 'Choose a .json file exported from NoteSpark.');
          await logImport(0, 'File was not a valid backup.');
          return;
        }
        const msg = await runImport(parsed, 0);
        alert('Notes imported', msg, [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Import failed.';
        alert("Couldn't import notes", `Your existing notes are unchanged. ${errorMessage}`);
        await logImport(0, errorMessage);
      } finally {
        setFileImporting(false);
      }
    });
  };

  React.useEffect(() => {
    return () => {
      setIsExporting(false);
    };
  }, []);

  const historyTitle = (h: any) => {
    const kind = h.type === 'import' ? 'Import' : 'Export';
    const count = typeof h.count === 'number' ? h.count : 0;
    return count > 0 ? `${kind}ed ${count} notes` : `${kind} didn't finish`;
  };
  const formatDate = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const lastBackup = history.find(h => h.type === 'export' && typeof h.count === 'number' && h.count > 0);

  const sectionTitle = (title: string) => (
    <Text variant="titleSmall" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.colors.primary }]}>{title}</Text>
  );
  const panelIcon = (icon: string, background: string, color: string) => (
    <View style={[styles.panelIcon, { backgroundColor: background }]}>
      <Icon source={icon} size={22} color={color} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header elevated={elevated}
        title="Import and export"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
          />
        }
      >
        <View style={styles.column}>
          <View style={styles.summary}>
            <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>
              {noteCount === null ? ' ' : noteCount === 1 ? '1 note on this device' : `${noteCount} notes on this device`}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {lastBackup ? `Last backup ${formatDate(lastBackup.date)}` : 'No backup yet. Export your notes to keep a copy off this phone.'}
            </Text>
          </View>

          {sectionTitle('Back up')}
          <View style={[styles.panel, { backgroundColor: theme.colors.surfaceContainerLow }]}>
            <View style={styles.panelHeader}>
              {panelIcon('export-variant', theme.colors.primaryContainer, theme.colors.onPrimaryContainer)}
              <View style={styles.panelText}>
                <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>Export all notes</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  Saves every note as one JSON file. Keep it in your files or a cloud drive.
                </Text>
              </View>
            </View>
            <Button
              mode="contained"
              icon="export-variant"
              onPress={handleExport}
              loading={isExporting}
              disabled={isExporting}
              style={styles.panelAction}
            >
              Export notes
            </Button>
          </View>

          {sectionTitle('Restore')}
          <View style={[styles.panel, { backgroundColor: theme.colors.surfaceContainerLow }]}>
            <View style={styles.panelHeader}>
              {panelIcon('file-restore-outline', theme.colors.secondaryContainer, theme.colors.onSecondaryContainer)}
              <View style={styles.panelText}>
                <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>Import a backup</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  Bring notes in from a NoteSpark export file. Choose how:
                </Text>
              </View>
            </View>
            <RadioButton.Group value={importMode} onValueChange={value => setImportMode(value as ImportMode)}>
              <RadioButton.Item label="Add new notes, skip duplicates" value="merge" mode="android" style={styles.radio} labelVariant="bodyLarge" />
              <RadioButton.Item label="Add all notes" value="append" mode="android" style={styles.radio} labelVariant="bodyLarge" />
              <RadioButton.Item label="Replace all notes" value="replace" mode="android" style={styles.radio} labelVariant="bodyLarge" />
            </RadioButton.Group>
            {importMode === 'replace' && (
              <View style={[styles.banner, { backgroundColor: theme.colors.errorContainer }]}>
                <Icon source="alert-outline" size={20} color={theme.colors.onErrorContainer} />
                <Text variant="bodyMedium" style={[styles.panelText, { color: theme.colors.onErrorContainer }]}>
                  Replacing deletes every note on this device first. Export first if you want to keep them.
                </Text>
              </View>
            )}
            <Button
              mode="contained-tonal"
              icon="file-upload-outline"
              onPress={handleFileImport}
              loading={fileImporting}
              disabled={fileImporting}
              style={styles.panelAction}
            >
              Choose backup file
            </Button>
            {pasteOpen ? (
              <>
                <TextInput
                  mode="outlined"
                  label="Paste JSON"
                  value={importData}
                  onChangeText={setImportData}
                  multiline
                  numberOfLines={6}
                  style={styles.pasteInput}
                />
                <View style={styles.pasteActions}>
                  <Button mode="text" onPress={() => { setPasteOpen(false); setImportData(''); }}>Cancel</Button>
                  <Button
                    mode="outlined"
                    onPress={handleImport}
                    loading={isImporting}
                    disabled={isImporting || !importData.trim()}
                  >
                    Import pasted JSON
                  </Button>
                </View>
              </>
            ) : (
              <Button mode="text" icon="content-paste" onPress={() => setPasteOpen(true)} style={styles.pasteToggle}>
                Paste JSON instead
              </Button>
            )}
          </View>

          <View style={styles.historyHeader}>
            <Text variant="titleSmall" accessibilityRole="header" style={[styles.historyTitle, { color: theme.colors.primary }]}>History</Text>
            <Menu
              visible={historyMenuVisible}
              onDismiss={() => setHistoryMenuVisible(false)}
              anchor={
                <IconButton
                  icon="dots-vertical"
                  onPress={() => setHistoryMenuVisible(true)}
                  disabled={history.length === 0 || pdfExporting}
                  accessibilityLabel="History options"
                />
              }
            >
              <Menu.Item
                leadingIcon="file-pdf-box"
                title="Save as PDF"
                onPress={() => { setHistoryMenuVisible(false); handleExportHistoryPDF(); }}
              />
              <Menu.Item
                leadingIcon="delete-outline"
                title="Clear history"
                titleStyle={{ color: theme.colors.error }}
                onPress={() => { setHistoryMenuVisible(false); clearHistory(); }}
              />
            </Menu>
          </View>
          {history.length === 0 ? (
            <View style={[styles.emptyHistory, groupCorners(true, true), { backgroundColor: theme.colors.surfaceContainerLow }]}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Your imports and exports will appear here.
              </Text>
            </View>
          ) : (
            history.map((h, idx) => {
              const failed = !(typeof h.count === 'number' && h.count > 0);
              return (
                <GroupedRow
                  key={idx}
                  title={historyTitle(h)}
                  description={`${formatDate(h.date)}${h.error && h.error.trim() ? `\n${h.error}` : ''}`}
                  icon={failed ? 'alert-circle-outline' : h.type === 'import' ? 'download-outline' : 'upload-outline'}
                  danger={failed}
                  isFirst={idx === 0}
                  isLast={idx === history.length - 1}
                />
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
  },
  column: {
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  summary: {
    gap: space.xs,
    paddingTop: space.sm,
  },
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  panel: {
    borderRadius: shape.group,
    padding: space.lg,
    gap: space.md,
  },
  panelHeader: {
    flexDirection: 'row',
    gap: space.md,
  },
  panelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelText: {
    flex: 1,
    gap: 2,
  },
  panelAction: {
    alignSelf: 'flex-start',
  },
  banner: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: shape.small,
  },
  radio: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  pasteToggle: {
    alignSelf: 'flex-start',
    marginLeft: -space.md,
  },
  pasteInput: {
    minHeight: 120,
  },
  pasteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xl,
    marginLeft: space.xs,
  },
  historyTitle: {
    flex: 1,
  },
  emptyHistory: {
    padding: space.lg,
  },
});

export default ImportExportScreen;
