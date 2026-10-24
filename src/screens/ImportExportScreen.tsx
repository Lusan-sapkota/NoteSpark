import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Alert, Share, Platform, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Icon, Text, TextInput } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { exportNotesAsJson, importNotesFromJson } from '../storage/database';
import { sendAppNotification } from '../utils/notifications';
import { importNotesFromFile } from '../storage/database';
import Header from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useTheme } from '../theme/ThemeContext';
import { lightTheme, readingWidth, shape, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type ImportExportScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportExport'>;

const ImportExportScreen: React.FC = () => {
  const navigation = useNavigation<ImportExportScreenNavigationProp>();
  const { theme } = useTheme();
  const [importData, setImportData] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [fileImporting, setFileImporting] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const handleExportHistoryPDF = async () => {
    Alert.alert(
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
              Alert.alert("Couldn't create the PDF", 'Try again.');
            }
            setPdfExporting(false);
          },
        },
      ]
    );
  };

  const loadHistory = async () => {
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
    Alert.alert(
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

      Alert.alert(
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
                await sendAppNotification('Notes Exported', `Exported ${notesArr.length} notes.`);
                await addHistory({
                  type: 'export',
                  date: new Date().toISOString(),
                  count: notesArr.length,
                  error: '',
                });
                Alert.alert('Notes exported', `${notesArr.length} notes exported.`, [
                  { text: 'OK' }
                ]);
              } else {
                if (jsonString.length > 50000) {
                  Alert.alert('Export is too large to share as text', 'Save the export with a file manager app instead.');
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
                  await sendAppNotification('Notes Exported', `Exported ${notesArr.length} notes.`);
                  await addHistory({
                    type: 'export',
                    date: new Date().toISOString(),
                    count: notesArr.length,
                    error: '',
                  });
                  Alert.alert('Notes exported', `${notesArr.length} notes exported.`, [
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
      Alert.alert("Couldn't export notes", errorMessage);
      await addHistory({
        type: 'export',
        date: new Date().toISOString(),
        count: 0,
        error: errorMessage,
      });
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importData.trim()) {
      Alert.alert('Paste your backup first', 'Paste the JSON from a NoteSpark export, or choose a file instead.');
      await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'No data entered.' });
      return;
    }
    Alert.alert(
      'Replace all notes?',
      'Importing replaces every note on this device with the notes in the backup. Export your current notes first if you want to keep them.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: async () => {
            await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'User cancelled import.' });
          }
        },
        {
          text: 'Replace notes',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsImporting(true);
              let parsed: any = [];
              let errorCount = 0;
              try {
                parsed = JSON.parse(importData);
                if (!Array.isArray(parsed)) throw new Error('Not an array');
              } catch (e) {
                Alert.alert("That isn't valid JSON", 'Check that you pasted the whole export file.');
                setIsImporting(false);
                await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'Invalid JSON format.' });
                return;
              }
              const validNotes = parsed.map((note: any) => {
                let valid = true;
                if (typeof note.isMarkdown !== 'boolean') {
                  note.isMarkdown = !!note.isMarkdown;
                }
                if (!note.title || !note.content || !note.createdAt || !note.updatedAt) {
                  valid = false;
                }
                if (isNaN(Date.parse(note.createdAt)) || isNaN(Date.parse(note.updatedAt))) {
                  valid = false;
                }
                if (!valid) errorCount++;
                return valid ? note : null;
              }).filter(Boolean);
              if (validNotes.length === 0) {
                Alert.alert('No notes found', "The backup doesn't contain any notes NoteSpark can read.");
                setIsImporting(false);
                await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'No valid notes found.' });
                return;
              }
              const notesModule = await import('../storage/notes');
              await notesModule.importNotesFromJson(JSON.stringify(validNotes));
              const result = validNotes.length;
              setIsImporting(false);
              setImportData('');
              let msg = `${result} notes imported.`;
              if (errorCount > 0) msg += ` ${errorCount} notes were skipped because they were incomplete.`;
              await sendAppNotification('Notes Imported', msg);
              await addHistory({ type: 'import', date: new Date().toISOString(), count: result, error: errorCount > 0 ? `${errorCount} notes skipped.` : '' });
              await loadHistory();
              Alert.alert('Notes imported', msg, [
                { text: 'OK', onPress: async () => {
                  await loadHistory();
                } },
              ]);
            } catch (error) {
              console.error('Failed to import notes:', error);
              Alert.alert("Couldn't import notes", 'Check that the data is a NoteSpark export.');
              setIsImporting(false);
              await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'Import failed.' });
            }
          },
        },
      ]
    );
  };

  const handleFileImport = async () => {
    Alert.alert(
      'Replace all notes?',
      'Importing replaces every note on this device with the notes in the backup. Export your current notes first if you want to keep them.',
      [
        { text: 'Cancel', style: 'cancel', onPress: async () => {
          await addHistory({
            type: 'import',
            date: new Date().toISOString(),
            count: 0,
            error: 'User cancelled file import.'
          });
        } },
        {
          text: 'Replace notes',
          style: 'destructive',
          onPress: async () => {
            try {
              setFileImporting(true);
              const count = await importNotesFromFile();
              setFileImporting(false);
              await sendAppNotification('Notes Imported', `${count} notes imported successfully!`);
              await addHistory({
                type: 'import',
                date: new Date().toISOString(),
                count: typeof count === 'number' && !isNaN(count) ? count : 0,
                error: typeof count === 'number' && count > 0 ? '' : 'No notes imported from file.'
              });
              Alert.alert('Notes imported', `${count} notes imported.`, [
                { text: 'OK', onPress: () => navigation.goBack() },
              ]);
            } catch (error) {
              setFileImporting(false);
              const errorMessage = typeof error === 'object' && error !== null && 'message' in error
                ? String((error as { message?: string }).message)
                : 'Failed to import notes from file. Please check your JSON file and permissions.';
              Alert.alert("Couldn't import notes", errorMessage);
              await addHistory({
                type: 'import',
                date: new Date().toISOString(),
                count: 0,
                error: errorMessage
              });
            }
          },
        },
      ]
    );
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

  const sectionTitle = (title: string) => (
    <Text variant="titleSmall" style={[styles.sectionTitle, { color: theme.colors.primary }]}>{title}</Text>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
      <Header
        title="Import and export"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
          />
        }
      >
        <View style={styles.column}>
          {sectionTitle('Export')}
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Save all your notes as a JSON file you can keep, share or import later.
          </Text>
          <Button
            mode="contained"
            icon="export-variant"
            onPress={handleExport}
            loading={isExporting}
            disabled={isExporting}
            style={styles.action}
          >
            Export notes
          </Button>

          {sectionTitle('Import')}
          <View style={[styles.banner, { backgroundColor: theme.colors.errorContainer }]}>
            <Icon source="alert-outline" size={20} color={theme.colors.onErrorContainer} />
            <Text variant="bodyMedium" style={[styles.bannerText, { color: theme.colors.onErrorContainer }]}>
              Importing replaces all notes on this device. Export first if you want to keep them.
            </Text>
          </View>
          <Button
            mode="contained-tonal"
            icon="file-upload-outline"
            onPress={handleFileImport}
            loading={fileImporting}
            disabled={fileImporting}
            style={styles.action}
          >
            Choose JSON file
          </Button>
          <TextInput
            mode="outlined"
            label="Or paste JSON"
            value={importData}
            onChangeText={setImportData}
            multiline
            numberOfLines={6}
            style={styles.pasteInput}
          />
          <Button
            mode="outlined"
            onPress={handleImport}
            loading={isImporting}
            disabled={isImporting || !importData.trim()}
            style={styles.action}
          >
            Import notes
          </Button>

          <View style={styles.historyHeader}>
            <Text variant="titleSmall" style={[styles.historyTitle, { color: theme.colors.primary }]}>History</Text>
            <Button
              mode="text"
              icon="file-pdf-box"
              onPress={handleExportHistoryPDF}
              loading={pdfExporting}
              disabled={pdfExporting || history.length === 0}
              compact
            >
              Save as PDF
            </Button>
            <Button
              mode="text"
              onPress={clearHistory}
              disabled={history.length === 0}
              textColor={theme.colors.error}
              compact
            >
              Clear history
            </Button>
          </View>
          {history.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>No imports or exports yet.</Text>
          ) : (
            history.map((h, idx) => {
              const failed = !(typeof h.count === 'number' && h.count > 0);
              return (
                <GroupedRow
                  key={idx}
                  title={historyTitle(h)}
                  description={`${new Date(h.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${h.error && h.error.trim() ? `\n${h.error}` : ''}`}
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
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: space.md,
  },
  banner: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: shape.small,
  },
  bannerText: {
    flex: 1,
  },
  pasteInput: {
    marginTop: space.md,
    minHeight: 120,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  historyTitle: {
    flex: 1,
  },
});

export default ImportExportScreen;
