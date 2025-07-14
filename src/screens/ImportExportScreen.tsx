import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, Alert, Share, TextInput, Platform, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Text, ActivityIndicator } from 'react-native-paper';
import { RootStackParamList } from '../types';
import { exportNotesAsJson, importNotesFromJson } from '../storage/database';
import { sendAppNotification } from '../utils/notifications';
import { importNotesFromFile } from '../storage/database';
import Header from '../components/Header';
import { useTheme } from '../theme/ThemeContext';
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
  // PDF export loading state
  const [pdfExporting, setPdfExporting] = useState(false);
  // PDF export function
  const handleExportHistoryPDF = async () => {
    Alert.alert(
      'Export History as PDF',
      'Do you want to export your Import/Export history as a PDF?',
      [
        {
          text: 'No',
          style: 'cancel',
          onPress: () => {},
        },
        {
          text: 'Yes',
          onPress: async () => {
            setPdfExporting(true);
            try {
              // Prepare HTML for PDF
              let html = `<html><head><style>body{font-family:sans-serif;}h2{color:#1976d2;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f5f5f5;}tr:nth-child(even){background:#fafafa;}</style></head><body>`;
              html += `<h2>NoteSpark Import/Export History</h2><table><tr><th>Date</th><th>Type</th><th>Count</th><th>Note</th></tr>`;
              history.forEach(h => {
                html += `<tr><td>${new Date(h.date).toLocaleString()}</td><td>${h.type}</td><td>${typeof h.count === 'number' ? h.count : 0}</td><td>${h.error && h.error.trim() ? h.error : 'No error'}</td></tr>`;
              });
              html += `</table></body></html>`;
              // Generate PDF
              const Print = require('expo-print');
              const Sharing = require('expo-sharing');
              const { uri } = await Print.printToFileAsync({ html });
              // Share PDF
              await Sharing.shareAsync(uri);
            } catch (err) {
              Alert.alert('PDF Export Error', 'Failed to generate or share PDF.');
            }
            setPdfExporting(false);
          },
        },
      ]
    );
  };

  // Load history on mount and refresh
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

  // Clear history for debugging
  const clearHistory = async () => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to clear your Import/Export history? This action cannot be undone.',
      [
        {
          text: 'No',
          style: 'cancel',
          onPress: () => {},
        },
        {
          text: 'Yes',
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
      // Get notes as JSON, ensure all fields are correct
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
      // Fix isMarkdown to boolean
      notesArr = notesArr.map((note: any) => ({
        ...note,
        isMarkdown: typeof note.isMarkdown === 'boolean' ? note.isMarkdown : !!note.isMarkdown,
      }));
      const jsonString = JSON.stringify(notesArr, null, 2);

      // Prepare file for sharing
      const fileName = `notespark-export-${Date.now()}.json`;
      const fileUri = `${Platform.OS === 'android' ? '/storage/emulated/0/Download/' : ''}${fileName}`;

      // Save file to device (use expo-file-system or RNFS if available)
      let fileSaved = false;
      try {
        const FileSystem = require('expo-file-system');
        await FileSystem.writeAsStringAsync(fileUri, jsonString, { encoding: FileSystem.EncodingType.UTF8 });
        fileSaved = true;
      } catch (e) {
        fileSaved = false;
      }

      // Custom alert for user choice
      Alert.alert(
        'Export Notes',
        'You will be shown the share sheet. Choose "Continue" to proceed or "Cancel" to abort export.',
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
                Alert.alert('Export Complete', `Exported ${notesArr.length} notes.`, [
                  { text: 'OK' }
                ]);
              } else {
                if (jsonString.length > 50000) {
                  Alert.alert('Export Too Large', 'Your notes are too large to share as text. Please use a file app to save the export.');
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
                  Alert.alert('Export Complete', `Exported ${notesArr.length} notes.`, [
                    { text: 'OK' }
                  ]);
                }
              }
              setIsExporting(false);
            }
          }
        ]
      );
      // Do not setIsExporting(false) here, handled in both branches above
    } catch (error) {
      console.error('Failed to export notes:', error);
      const errorMessage =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: string }).message)
          : 'Failed to export notes. Please ensure storage permission is granted.';
      Alert.alert('Error', errorMessage);
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
      Alert.alert('Error', 'Please enter JSON data to import');
      await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'No data entered.' });
      return;
    }
    Alert.alert(
      'Import Notes',
      'Importing will replace all existing notes. Are you sure you want to continue?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: async () => {
            await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'User cancelled import.' });
          }
        },
        {
          text: 'Import',
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
                Alert.alert('Error', 'Invalid JSON format. Please check your data.');
                setIsImporting(false);
                await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'Invalid JSON format.' });
                return;
              }
              // Validate and fix notes
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
                Alert.alert('Warning', 'No valid notes found in import data.');
                setIsImporting(false);
                await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'No valid notes found.' });
                return;
              }
              // Import valid notes
              const notesModule = await import('../storage/notes');
              await notesModule.importNotesFromJson(JSON.stringify(validNotes));
              const result = validNotes.length;
              setIsImporting(false);
              setImportData('');
              let msg = `Imported ${result} notes successfully.`;
              if (errorCount > 0) msg += ` ${errorCount} notes were skipped due to errors.`;
              await sendAppNotification('Notes Imported', msg);
              await addHistory({ type: 'import', date: new Date().toISOString(), count: result, error: errorCount > 0 ? `${errorCount} notes skipped.` : '' });
              await loadHistory();
              Alert.alert('Import Complete', msg, [
                { text: 'OK', onPress: async () => {
                  await loadHistory();
                } },
              ]);
            } catch (error) {
              console.error('Failed to import notes:', error);
              Alert.alert('Error', 'Failed to import notes. Please check your JSON data format.');
              setIsImporting(false);
              await addHistory({ type: 'import', date: new Date().toISOString(), count: 0, error: 'Import failed.' });
            }
          },
        },
      ]
    );
  };

  const { requestStoragePermission } = require('../storage/database');
  const handleFileImport = async () => {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      Alert.alert('Permission Required', 'Storage permission is required to import notes from file.');
      await addHistory({
        type: 'import',
        date: new Date().toISOString(),
        count: 0,
        error: 'User denied storage permission for file import.'
      });
      return;
    }
    Alert.alert(
      'Import Notes from File',
      'Importing will replace all existing notes. Are you sure you want to continue?',
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
          text: 'Import',
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
              Alert.alert('Success', `${count} notes imported successfully`, [
                { text: 'OK', onPress: () => navigation.goBack() },
              ]);
            } catch (error) {
              setFileImporting(false);
              const errorMessage = typeof error === 'object' && error !== null && 'message' in error
                ? String((error as { message?: string }).message)
                : 'Failed to import notes from file. Please check your JSON file and permissions.';
              Alert.alert('Error', errorMessage);
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

  // Ensure export button resets on unmount/refresh
  React.useEffect(() => {
    return () => {
      setIsExporting(false);
    };
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Import/Export"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
          />
        }
      >
        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Card.Title 
            title="Export Notes" 
            titleStyle={{ color: theme.colors.primary }}
          />
          <Card.Content>
            <Text style={{ color: theme.colors.text, marginBottom: 16 }}>
              Export all your notes as a JSON file. You can save, share, or back up your notes to your device or cloud using the share sheet.
            </Text>
            <Button
              mode="contained"
              onPress={handleExport}
              loading={isExporting}
              disabled={isExporting}
              style={{ backgroundColor: theme.colors.primary }}
              labelStyle={{ color: '#fff' }}
            >
              Export Notes
            </Button>
          </Card.Content>
        </Card>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Card.Title 
            title="Import Notes" 
            titleStyle={{ color: theme.colors.primary }}
          />
          <Card.Content>
            <Text style={{ color: theme.colors.text, marginBottom: 16 }}>
              Import notes from a JSON backup. This will replace all existing notes.
            </Text>
            <TextInput
              style={[styles.importInput, { 
                color: theme.colors.text,
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.text + '40', // 25% opacity
              }]}
              placeholder="Paste JSON data here"
              placeholderTextColor={theme.colors.text + '80'} // 50% opacity
              value={importData}
              onChangeText={setImportData}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
            />
            <Button
              mode="outlined"
              onPress={handleFileImport}
              loading={fileImporting}
              disabled={fileImporting}
              style={{ marginTop: 12, borderColor: theme.colors.primary }}
              labelStyle={{ color: theme.colors.primary }}
            >
              Upload JSON File
            </Button>
            <Button
              mode="contained"
              onPress={handleImport}
              loading={isImporting}
              disabled={isImporting || !importData.trim()}
              style={{ backgroundColor: theme.colors.primary, marginTop: 16 }}
              labelStyle={{ color: '#fff' }}
            >
              Import Notes
            </Button>

          </Card.Content>
        </Card>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Card.Title 
            title="Warning" 
            titleStyle={{ color: theme.colors.error }}
          />
          <Card.Content>
            <Text style={{ color: theme.colors.text }}>
              Importing notes will replace all existing notes in the app. Make sure to export your current notes first if you want to keep them.
            </Text>
          </Card.Content>
        </Card>

        <Card style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
          <Card.Title 
            title="Import/Export History" 
            titleStyle={{ color: theme.colors.primary, fontSize: 15, fontWeight: 'bold' }}
            right={() => (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Button
            mode="text"
            onPress={handleExportHistoryPDF}
            compact
            loading={pdfExporting}
            disabled={pdfExporting}
            labelStyle={{ color: theme.colors.primary, fontWeight: 'bold', fontSize: 13 }}
            style={{ marginRight: 0 }}
            icon="file-download"
          >
            PDF
          </Button>
          <Text style={{ color: theme.colors.text, opacity: 0.5, fontSize: 16, marginHorizontal: 4 }}>|</Text>
          <Button
            mode="text"
            onPress={clearHistory}
            compact
            labelStyle={{ color: theme.colors.error, fontWeight: 'bold', fontSize: 13 }}
            style={{ marginRight: 4 }}
          >
            CLEAR
          </Button>
              </View>
            )}
          />
          <Card.Content>
            {history.length === 0 ? (
              <Text style={{ color: theme.colors.text, opacity: 0.7, fontSize: 13 }}>No history yet.</Text>
            ) : (
              history.map((h, idx) => (
          <View key={idx} style={{ marginBottom: 10 }}>
            <Text style={{ color: theme.colors.text, fontWeight: 'bold', fontSize: 13 }}>
              {h.type === 'import' ? 'Import' : 'Export'} - {new Date(h.date).toLocaleString()}
            </Text>
            <Text style={{ color: theme.colors.text, fontSize: 13 }}>
              Count: {typeof h.count === 'number' ? h.count : 0}
            </Text>
            <Text style={{ color: h.error ? theme.colors.error : theme.colors.text, fontSize: 11 }}>
              Note: {h.error && h.error.trim() ? h.error : 'No error'}
            </Text>
          </View>
              ))
            )}
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  card: {
    marginBottom: 16,
    elevation: 2,
  },
  importInput: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    minHeight: 120,
  },
});

export default ImportExportScreen;