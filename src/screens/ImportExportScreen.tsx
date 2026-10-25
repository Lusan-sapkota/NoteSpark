import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Share, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { cancelAnimation, Easing, SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Button, Dialog, Icon, IconButton, RadioButton, SegmentedButtons, Switch, Text, TextInput, TouchableRipple } from 'react-native-paper';
import Menu from '../components/Menu';
import { RootStackParamList } from '../types';
import { sendAppNotification } from '../utils/notifications';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { exportNotesAsJson, getNotes, importNotes, ImportMode } from '../storage/notes';
import { shareNotesAsZip } from '../utils/exportNotes';
import { AutoBackupSettings, BACKUPS_KEPT, folderName, getAutoBackup, pickBackupFolder, runBackup, setAutoBackup } from '../storage/autoBackup';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, lightTheme, readingWidth, shape, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

// M3 Expressive wavy progress indicator (indeterminate): a sine wave drawn from short rotated
// segments that travels while work runs. Holds still when the OS asks for reduced motion.
const WAVE = { amplitude: 3, wavelength: 22, stroke: 4, step: 4 };
const WAVE_HEIGHT = WAVE.amplitude * 2 + WAVE.stroke + 4;

const WaveSegment: React.FC<{ x: number; phase: SharedValue<number>; color: string }> = ({ x, phase, color }) => {
  const style = useAnimatedStyle(() => {
    const k = (2 * Math.PI) / WAVE.wavelength;
    const t = k * (x + WAVE.step / 2) + phase.value;
    return {
      transform: [
        { translateY: WAVE.amplitude * Math.sin(t) },
        { rotate: `${Math.atan(WAVE.amplitude * k * Math.cos(t))}rad` },
      ],
    };
  });
  return <Animated.View style={[styles.segment, { left: x, backgroundColor: color }, style]} />;
};

const WavyProgress: React.FC<{ color: string; label: string }> = ({ color, label }) => {
  const [width, setWidth] = useState(0);
  const phase = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    phase.value = withRepeat(withTiming(-2 * Math.PI, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(phase);
  }, [reduceMotion, phase]);
  const xs = Array.from({ length: Math.max(0, Math.floor(width / WAVE.step)) }, (_, i) => i * WAVE.step);
  return (
    <View
      style={styles.wave}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      {xs.map(x => <WaveSegment key={x} x={x} phase={phase} color={color} />)}
    </View>
  );
};

const importModes: { value: ImportMode; label: string; description: string }[] = [
  { value: 'merge', label: 'Skip duplicates', description: "Adds only notes you don't already have" },
  { value: 'append', label: 'Add everything', description: 'Adds every note, including copies' },
  { value: 'replace', label: 'Replace all notes', description: 'Deletes your current notes first' },
];

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
  const [importDialogVisible, setImportDialogVisible] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [historyMenuVisible, setHistoryMenuVisible] = useState(false);
  const [autoBackup, setAutoBackupState] = useState<AutoBackupSettings | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const formatDate = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
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
    getAutoBackup().then(setAutoBackupState).catch(() => {});
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
  // Markdown for other apps (Obsidian, Markor); the JSON backup stays the format NoteSpark restores from.
  const handleExportMarkdown = async () => {
    try {
      const notes = await getNotes();
      if (!notes.length) {
        alert('No notes to export', 'Write a note first, then export it here.');
        return;
      }
      await shareNotesAsZip(notes);
      await addHistory({ type: 'export', format: 'markdown', date: new Date().toISOString(), count: notes.length, error: '' });
    } catch (error) {
      alert("Couldn't export as Markdown", 'Try again. If it keeps failing, restart the app.');
    }
  };

  const saveAutoBackup = async (settings: AutoBackupSettings | null) => {
    await setAutoBackup(settings);
    setAutoBackupState(settings);
  };

  // Backs up now and records the result like an automatic run.
  const backUpNow = async (settings: AutoBackupSettings) => {
    setBackingUp(true);
    try {
      const { error } = await runBackup(settings);
      await saveAutoBackup({ ...settings, lastRun: new Date().toISOString(), lastError: error });
      if (error) alert("Couldn't back up every profile", 'One or more profiles could not be read.');
    } catch (error) {
      await saveAutoBackup({ ...settings, lastError: error instanceof Error ? error.message : String(error) });
      alert("Couldn't back up to the folder", 'Choose the folder again, or pick another one, then try again.');
    } finally {
      setBackingUp(false);
    }
  };

  const chooseBackupFolder = async () => {
    try {
      const folderUri = await pickBackupFolder();
      if (!folderUri) return;
      await backUpNow({ frequency: 'weekly', includeProtected: false, ...autoBackup, folderUri, lastError: undefined });
    } catch (error) {
      alert("Couldn't open the folder picker", 'Try again. If it keeps failing, restart the app.');
    }
  };

  // Protected profiles are only backed up after the person agrees their backup files are readable.
  const setIncludeProtected = (include: boolean) => {
    if (!autoBackup) return;
    if (!include) {
      saveAutoBackup({ ...autoBackup, includeProtected: false });
      return;
    }
    alert(
      'Back up protected profiles too?',
      "Backup files are ordinary files. Anyone who can open the backup folder can read every note in them, without the profile's PIN.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Include them', onPress: () => saveAutoBackup({ ...autoBackup, includeProtected: true }) },
      ]
    );
  };

  const backupStatus = !autoBackup
    ? ''
    : autoBackup.lastError
    ? "The last backup didn't finish. Choose the folder again or tap to try now."
    : autoBackup.lastRun
    ? `Last backup ${formatDate(autoBackup.lastRun)}`
    : 'No backup yet';

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
      // App cache needs no storage permission; the share sheet then saves it wherever the person picks.
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      let fileSaved = false;
      try {
        await FileSystem.writeAsStringAsync(fileUri, jsonString, { encoding: FileSystem.EncodingType.UTF8 });
        fileSaved = await Sharing.isAvailableAsync();
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
                // expo-sharing sends the actual file; React Native's Share only sends text on Android.
                await Sharing.shareAsync(fileUri, {
                  mimeType: 'application/json',
                  UTI: 'public.json',
                  dialogTitle: 'Save or share your notes',
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
    if (count > 0 && h.format === 'markdown') return `Exported ${count} notes as Markdown`;
    return count > 0 ? `${kind}ed ${count} notes` : `${kind} didn't finish`;
  };
  // Markdown exports can't be restored, so they don't count as a backup.
  const lastBackup = history.find(h => h.type === 'export' && h.format !== 'markdown' && typeof h.count === 'number' && h.count > 0);

  const importing = isImporting || fileImporting;

  const closeImportDialog = () => {
    setImportDialogVisible(false);
    setPasteOpen(false);
  };

  // An action tile: icon, title and a line of help; the wavy indicator replaces the help line's spacer while busy.
  const tile = (opts: { icon: string; title: string; body: string; busyBody: string; busy: boolean; onPress: () => void; background: string; color: string }) => (
    <View style={[styles.tile, { backgroundColor: opts.background }]}>
      <TouchableRipple
        onPress={opts.onPress}
        disabled={opts.busy}
        style={styles.tileInner}
        accessibilityRole="button"
        accessibilityLabel={opts.title}
        accessibilityState={{ busy: opts.busy, disabled: opts.busy }}
      >
        <View style={styles.tileContent}>
          <Icon source={opts.icon} size={28} color={opts.color} />
          <View style={styles.tileText}>
            <Text variant="titleMedium" style={{ color: opts.color }}>{opts.title}</Text>
            <Text variant="bodySmall" style={{ color: opts.color }}>{opts.busy ? opts.busyBody : opts.body}</Text>
          </View>
          {opts.busy ? <WavyProgress color={opts.color} label={opts.busyBody} /> : <View style={styles.waveSpacer} />}
        </View>
      </TouchableRipple>
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
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surfaceContainerHigh}
          />
        }
      >
        <View style={styles.column}>
          <View style={styles.summary}>
            <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>
              {noteCount === null ? ' ' : noteCount === 1 ? '1 note' : `${noteCount} notes`}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {lastBackup ? `Last backup ${formatDate(lastBackup.date)}` : 'Not backed up yet'}
            </Text>
          </View>

          <View style={styles.tiles}>
            {tile({
              icon: 'export-variant',
              title: 'Back up',
              body: 'Save all notes as a JSON file',
              busyBody: 'Exporting notes',
              busy: isExporting,
              onPress: handleExport,
              background: theme.colors.primaryContainer,
              color: theme.colors.onPrimaryContainer,
            })}
            {tile({
              icon: 'file-restore-outline',
              title: 'Restore',
              body: 'Bring notes in from a backup',
              busyBody: 'Importing notes',
              busy: importing,
              onPress: () => setImportDialogVisible(true),
              background: theme.colors.secondaryContainer,
              color: theme.colors.onSecondaryContainer,
            })}
          </View>

          <View style={styles.rows}>
            <GroupedRow
              title="Export as Markdown"
              description="Every note as a Markdown file, in one zip, for other notes apps"
              icon="language-markdown-outline"
              onPress={handleExportMarkdown}
              isFirst
              isLast
            />
          </View>

          <Text variant="titleSmall" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
            Automatic backups
          </Text>
          <GroupedRow
            title="Back up automatically"
            description={autoBackup
              ? `To ${folderName(autoBackup.folderUri)}. Keeps the last ${BACKUPS_KEPT} of each profile.`
              : `Save a backup to a folder you choose, every day or week. Keeps the last ${BACKUPS_KEPT}.`}
            icon="folder-sync-outline"
            onPress={autoBackup ? () => saveAutoBackup(null) : chooseBackupFolder}
            right={
              <Switch
                value={!!autoBackup}
                onValueChange={on => (on ? chooseBackupFolder() : saveAutoBackup(null))}
                accessibilityLabel="Back up automatically"
              />
            }
            isFirst
            isLast={!autoBackup}
          />
          {autoBackup && (
            <>
              <GroupedRow
                title="Back up now"
                description={backingUp ? 'Backing up' : backupStatus}
                icon={autoBackup.lastError ? 'alert-circle-outline' : 'backup-restore'}
                danger={!!autoBackup.lastError}
                onPress={() => backUpNow(autoBackup)}
                disabled={backingUp}
                isFirst={false}
                isLast={false}
              />
              <GroupedRow
                title="Backup folder"
                description={folderName(autoBackup.folderUri)}
                icon="folder-outline"
                onPress={chooseBackupFolder}
                isFirst={false}
                isLast={false}
              />
              <GroupedRow
                title="Include protected profiles"
                description="Off: profiles with a PIN aren't backed up automatically"
                icon="lock-outline"
                onPress={() => setIncludeProtected(!autoBackup.includeProtected)}
                right={
                  <Switch
                    value={autoBackup.includeProtected}
                    onValueChange={setIncludeProtected}
                    accessibilityLabel="Include protected profiles"
                  />
                }
                isFirst={false}
                isLast
              />
              <SegmentedButtons
                theme={controlTheme}
                value={autoBackup.frequency}
                onValueChange={value => saveAutoBackup({ ...autoBackup, frequency: value as 'daily' | 'weekly' })}
                style={styles.frequency}
                buttons={[
                  { value: 'daily', label: 'Every day', icon: 'calendar-today' },
                  { value: 'weekly', label: 'Every week', icon: 'calendar-week' },
                ]}
              />
              <Text variant="bodySmall" style={[styles.backupHelp, { color: theme.colors.onSurfaceVariant }]}>
                Backups run when you open NoteSpark and one is due. Restore one with Restore above.
              </Text>
            </>
          )}

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
            <Text variant="bodyMedium" style={[styles.emptyHistory, { color: theme.colors.onSurfaceVariant }]}>
              Backups and imports will appear here.
            </Text>
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

      <KeyboardSafePortal>
        <Dialog visible={importDialogVisible} onDismiss={closeImportDialog}>
          <Dialog.Title>Import notes</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScroll}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
              <RadioButton.Group value={importMode} onValueChange={value => setImportMode(value as ImportMode)}>
                {importModes.map(mode => (
                  <TouchableRipple
                    key={mode.value}
                    onPress={() => setImportMode(mode.value)}
                    style={styles.modeRow}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: importMode === mode.value }}
                  >
                    <View style={styles.modeRowInner}>
                      <RadioButton.Android value={mode.value} />
                      <View style={styles.tileText}>
                        <Text variant="bodyLarge" style={{ color: mode.value === 'replace' ? theme.colors.error : theme.colors.onSurface }}>
                          {mode.label}
                        </Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{mode.description}</Text>
                      </View>
                    </View>
                  </TouchableRipple>
                ))}
              </RadioButton.Group>
              {importMode === 'replace' && (
                <View style={[styles.banner, { backgroundColor: theme.colors.errorContainer }]}>
                  <Icon source="alert-outline" size={20} color={theme.colors.onErrorContainer} />
                  <Text variant="bodyMedium" style={[styles.tileText, { color: theme.colors.onErrorContainer }]}>
                    Every note on this device will be deleted. Back up first if you want to keep them.
                  </Text>
                </View>
              )}
              {pasteOpen ? (
                <>
                  <TextInput
                    mode="outlined"
                    label="Paste JSON"
                    value={importData}
                    onChangeText={setImportData}
                    multiline
                    numberOfLines={4}
                    style={styles.pasteInput}
                  />
                  <Button
                    mode="contained"
                    theme={controlTheme}
                    onPress={() => { closeImportDialog(); handleImport(); }}
                    disabled={!importData.trim()}
                  >
                    Import pasted JSON
                  </Button>
                </>
              ) : (
                <>
                  <Button mode="contained" icon="file-upload-outline" theme={controlTheme} onPress={() => { closeImportDialog(); handleFileImport(); }}>
                    Choose backup file
                  </Button>
                  <Button mode="text" icon="content-paste" onPress={() => setPasteOpen(true)}>
                    Paste JSON instead
                  </Button>
                </>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={closeImportDialog}>Cancel</Button>
          </Dialog.Actions>
        </Dialog>
      </KeyboardSafePortal>
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
    paddingHorizontal: space.xs,
  },
  tiles: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
  },
  tile: {
    flex: 1,
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
  },
  tileInner: {
    flexGrow: 1,
  },
  tileContent: {
    flexGrow: 1,
    minHeight: 168,
    padding: space.lg,
    justifyContent: 'space-between',
    gap: space.md,
  },
  tileText: {
    flex: 1,
    gap: 2,
  },
  wave: {
    height: WAVE_HEIGHT,
    overflow: 'hidden',
  },
  waveSpacer: {
    height: WAVE_HEIGHT,
  },
  segment: {
    position: 'absolute',
    top: (WAVE_HEIGHT - WAVE.stroke) / 2,
    width: WAVE.step * 1.5,
    height: WAVE.stroke,
    marginLeft: -WAVE.step * 0.25,
    borderRadius: WAVE.stroke / 2,
  },
  rows: {
    marginTop: space.md,
  },
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  frequency: {
    marginTop: space.md,
  },
  backupHelp: {
    marginTop: space.sm,
    marginLeft: space.xs,
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
    paddingHorizontal: space.xs,
  },
  dialogScroll: {
    paddingHorizontal: 0,
  },
  dialogContent: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    gap: space.md,
  },
  modeRow: {
    borderRadius: shape.small,
    marginHorizontal: -space.sm,
  },
  modeRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    paddingRight: space.sm,
  },
  banner: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: shape.small,
  },
  pasteInput: {
    minHeight: 96,
  },
});

export default ImportExportScreen;
