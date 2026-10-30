import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, Share, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { cancelAnimation, Easing, SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Button, Dialog, Icon, IconButton, RadioButton, SegmentedButtons, Text, TextInput, TouchableRipple } from 'react-native-paper';
import Menu from '../components/Menu';
import { RootStackParamList } from '../types';
import { sendAppNotification } from '../utils/notifications';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { exportNotesAsJson, getNotes, importNotes, ImportMode } from '../storage/notes';
import { notesFromFile, shareNotesAsZip } from '../utils/exportNotes';
import M3Switch from '../components/M3Switch';
import { AutoBackupSettings, BACKUPS_KEPT, folderName, getAutoBackup, pickBackupFolder, runBackup, setAutoBackup } from '../storage/autoBackup';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Header, { useHeaderElevation } from '../components/Header';
import GroupedRow from '../components/GroupedRow';
import { useAlert } from '../components/DialogProvider';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, lightTheme, readingWidth, shape, space } from '../theme/theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getLanguage } from '@notespark/core';
import { useI18n } from '../i18n/I18nContext';

// Wavy indeterminate progress indicator; holds still under reduced motion.
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


type ImportExportScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportExport'>;

const ImportExportScreen: React.FC = () => {
  const navigation = useNavigation<ImportExportScreenNavigationProp>();
  const { t } = useI18n();
  const importModes: { value: ImportMode; label: string; description: string }[] = [
    { value: 'merge', label: t('importExport.modeMerge'), description: t('importExport.modeMergeBody') },
    { value: 'append', label: t('importExport.modeAppend'), description: t('importExport.modeAppendBody') },
    { value: 'replace', label: t('importExport.modeReplace'), description: t('importExport.modeReplaceBody') },
  ];
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
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const formatDate = (iso: string) => new Date(iso).toLocaleString(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
  const handleExportHistoryPDF = async () => {
    alert(
      t('importExport.exportHistoryPdfTitle'),
      t('importExport.exportHistoryPdfBody'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => {},
        },
        {
          text: t('importExport.exportPdf'),
          onPress: async () => {
            setPdfExporting(true);
            try {
              // Printed on white, so the PDF uses the light scheme.
              const c = lightTheme.colors;
              let html = `<html><head><style>body{font-family:sans-serif;color:${c.onSurface};}h2{color:${c.primary};}table{width:100%;border-collapse:collapse;}th,td{border:1px solid ${c.outlineVariant};padding:8px;text-align:left;}th{background:${c.surfaceContainer};}tr:nth-child(even){background:${c.surfaceContainerLow};}</style></head><body>`;
              html += `<h2>${t('importExport.pdfHeading')}</h2><table><tr><th>${t('importExport.pdfDate')}</th><th>${t('importExport.pdfType')}</th><th>${t('importExport.pdfCount')}</th><th>${t('importExport.pdfNote')}</th></tr>`;
              history.forEach(h => {
                html += `<tr><td>${new Date(h.date).toLocaleString(getLanguage())}</td><td>${h.type === 'import' ? t('importExport.typeImport') : t('importExport.typeExport')}</td><td>${typeof h.count === 'number' ? h.count : 0}</td><td>${h.error && h.error.trim() ? h.error : t('importExport.pdfNoError')}</td></tr>`;
              });
              html += `</table></body></html>`;
              const Print = require('expo-print');
              const { uri } = await Print.printToFileAsync({ html });
              await Sharing.shareAsync(uri);
            } catch (err) {
              alert(t('importExport.pdfFailed'), t('importExport.tryAgain'));
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
      t('importExport.clearHistoryTitle'),
      t('importExport.clearHistoryBody'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => {},
        },
        {
          text: t('importExport.clearHistory'),
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
        alert(t('importExport.noNotesToExport'), t('importExport.noNotesToExportBody'));
        return;
      }
      await shareNotesAsZip(notes, { includeAttachments });
      await addHistory({ type: 'export', format: 'markdown', date: new Date().toISOString(), count: notes.length, error: '' });
    } catch (error) {
      alert(t('importExport.markdownExportFailed'), t('common.tryAgainRestart'));
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
      if (error) alert(t('importExport.backupProfilesFailed'), t('importExport.backupProfilesFailedBody'));
    } catch (error) {
      await saveAutoBackup({ ...settings, lastError: error instanceof Error ? error.message : String(error) });
      alert(t('importExport.backupFolderFailed'), t('importExport.backupFolderFailedBody'));
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
      alert(t('importExport.folderPickerFailed'), t('common.tryAgainRestart'));
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
      t('importExport.protectedTitle'),
      t('importExport.protectedBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('importExport.includeThem'), onPress: () => saveAutoBackup({ ...autoBackup, includeProtected: true }) },
      ]
    );
  };

  const backupStatus = !autoBackup
    ? ''
    : autoBackup.lastError
    ? t('importExport.lastBackupFailed')
    : autoBackup.lastRun
    ? t('importExport.lastBackup', { date: formatDate(autoBackup.lastRun) })
    : t('importExport.noBackupYet');

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
        t('importExport.exportNotesTitle'),
        t('importExport.exportNotesBody'),
        [
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: async () => {
              await addHistory({
                type: 'export',
                date: new Date().toISOString(),
                count: 0,
                error: t('importExport.exportCancelled')
              });
              setIsExporting(false);
            }
          },
          {
            text: t('common.continue'),
            onPress: async () => {
              if (fileSaved) {
                // expo-sharing sends the actual file; React Native's Share only sends text on Android.
                await Sharing.shareAsync(fileUri, {
                  mimeType: 'application/json',
                  UTI: 'public.json',
                  dialogTitle: t('importExport.saveOrShareNotes'),
                });
                await sendAppNotification(t('importExport.notesExported'), t('importExport.notesExportedCount', { count: notesArr.length }));
                await addHistory({
                  type: 'export',
                  date: new Date().toISOString(),
                  count: notesArr.length,
                  error: '',
                });
                alert(t('importExport.notesExported'), t('importExport.notesExportedCount', { count: notesArr.length }), [
                  { text: t('common.ok') }
                ]);
              } else {
                if (jsonString.length > 50000) {
                  alert(t('importExport.exportTooLarge'), t('importExport.exportTooLargeBody'));
                  await addHistory({
                    type: 'export',
                    date: new Date().toISOString(),
                    count: 0,
                    error: t('importExport.exportTooLargeHistory')
                  });
                } else {
                  await Share.share({
                    title: t('importExport.exportedNotesShareTitle'),
                    message: jsonString,
                  });
                  await sendAppNotification(t('importExport.notesExported'), t('importExport.notesExportedCount', { count: notesArr.length }));
                  await addHistory({
                    type: 'export',
                    date: new Date().toISOString(),
                    count: notesArr.length,
                    error: '',
                  });
                  alert(t('importExport.notesExported'), t('importExport.notesExportedCount', { count: notesArr.length }), [
                    { text: t('common.ok') }
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
          : t('importExport.exportFailedFallback');
      alert(t('importExport.exportFailed'), errorMessage);
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
    // One sentence per part, joined with spaces.
    const msg = [
      t('importExport.noteImported', { count: imported }),
      skipped > 0 && t('importExport.alreadyOnDevice', { count: skipped }),
      incomplete > 0 && t('importExport.incompleteSkipped', { count: incomplete }),
    ].filter(Boolean).join(' ');
    await sendAppNotification(t('importExport.notesImported'), msg);
    const notesLine = [skipped > 0 && t('importExport.duplicatesSkipped', { count: skipped }), incomplete > 0 && t('importExport.incompleteSkipped', { count: incomplete })].filter(Boolean).join(' ');
    await logImport(imported, imported === 0 ? t('importExport.allAlreadyOnDevice') : notesLine);
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
      t('importExport.replaceTitle'),
      t('importExport.replaceBody'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => { logImport(0, t('importExport.importCancelled')); } },
        { text: t('importExport.replaceNotes'), style: 'destructive', onPress: action },
      ]
    );
  };

  const handleImport = () => {
    if (!importData.trim()) {
      alert(t('importExport.pasteFirst'), t('importExport.pasteFirstBody'));
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
          alert(t('importExport.invalidJson'), t('importExport.invalidJsonBody'));
          await logImport(0, t('importExport.invalidJsonHistory'));
          return;
        }
        const validNotes = parsed.filter((note: any) =>
          note && note.title && note.content && !isNaN(Date.parse(note.createdAt)) && !isNaN(Date.parse(note.updatedAt))
        ).map((note: any) => ({ ...note, isMarkdown: !!note.isMarkdown }));
        if (validNotes.length === 0) {
          alert(t('importExport.noNotesFound'), t('importExport.noNotesFoundBody'));
          await logImport(0, t('importExport.noValidNotes'));
          return;
        }
        const msg = await runImport(validNotes, parsed.length - validNotes.length);
        setImportData('');
        setPasteOpen(false);
        alert(t('importExport.notesImported'), msg);
      } catch (error) {
        console.error('Failed to import notes:', error);
        alert(t('importExport.importFailed'), t('importExport.importFailedBody'));
        await logImport(0, t('importExport.importFailedHistory'));
      } finally {
        setIsImporting(false);
      }
    });
  };

  const handleFileImport = () => {
    confirmIfReplacing(async () => {
      try {
        setFileImporting(true);
        // Any type, since Android often labels .md as unknown; read from content:// directly.
        const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: false });
        if (result.canceled || !result.assets?.length) return;
        const parsed: any[] = [];
        const unreadable: string[] = [];
        for (const asset of result.assets) {
          try {
            parsed.push(...(await notesFromFile(asset.uri, asset.name)));
          } catch (error) {
            console.warn(`Couldn't read ${asset.name}:`, error);
            unreadable.push(asset.name);
          }
        }
        if (!parsed.length) {
          alert(t('importExport.filesUnreadable'), t('importExport.filesUnreadableBody'));
          await logImport(0, t('importExport.filesNotBackups'));
          return;
        }
        let msg = await runImport(parsed, 0);
        if (unreadable.length) msg += ` ${t('importExport.couldntRead', { names: unreadable.join(', ') })}`;
        alert(t('importExport.notesImported'), msg, [{ text: t('common.ok'), onPress: () => navigation.goBack() }]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t('importExport.importFailedHistory');
        alert(t('importExport.importFailed'), t('importExport.importFailedWith', { error: errorMessage }));
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
    const isImport = h.type === 'import';
    const count = typeof h.count === 'number' ? h.count : 0;
    if (count > 0 && h.format === 'markdown') return t('importExport.markdownExported', { count });
    if (count > 0) return isImport ? t('importExport.imported', { count }) : t('importExport.exported', { count });
    return isImport ? t('importExport.importDidntFinish') : t('importExport.exportDidntFinish');
  };
  // Markdown exports can't be restored, so they don't count as a backup.
  const lastBackup = history.find(h => h.type === 'export' && h.format !== 'markdown' && typeof h.count === 'number' && h.count > 0);

  const importing = isImporting || fileImporting;

  const closeImportDialog = () => {
    setImportDialogVisible(false);
    setPasteOpen(false);
  };

  // An action tile: icon, title and help line; the wavy indicator shows while busy.
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
        title={t('importExport.title')}
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
              {noteCount === null ? ' ' : t('importExport.noteCount', { count: noteCount })}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {lastBackup ? t('importExport.lastBackup', { date: formatDate(lastBackup.date) }) : t('importExport.notBackedUp')}
            </Text>
          </View>

          <View style={styles.tiles}>
            {tile({
              icon: 'export-variant',
              title: t('importExport.backUp'),
              body: t('importExport.backUpBody'),
              busyBody: t('importExport.exportingNotes'),
              busy: isExporting,
              onPress: handleExport,
              background: theme.colors.primaryContainer,
              color: theme.colors.onPrimaryContainer,
            })}
            {tile({
              icon: 'file-restore-outline',
              title: t('common.restore'),
              body: t('importExport.restoreBody'),
              busyBody: t('importExport.importingNotes'),
              busy: importing,
              onPress: () => setImportDialogVisible(true),
              background: theme.colors.secondaryContainer,
              color: theme.colors.onSecondaryContainer,
            })}
          </View>

          <View style={styles.rows}>
            <GroupedRow
              title={t('importExport.exportMarkdown')}
              description={t('importExport.exportMarkdownBody')}
              icon="language-markdown-outline"
              onPress={handleExportMarkdown}
              isFirst
              isLast={false}
            />
            <GroupedRow
              title={t('importExport.includeAttachments')}
              description={includeAttachments ? t('importExport.attachmentsIncluded') : t('importExport.attachmentsExcluded')}
              icon="paperclip"
              onPress={() => setIncludeAttachments(v => !v)}
              right={
                <M3Switch
                  value={includeAttachments}
                  onValueChange={setIncludeAttachments}
                  accessibilityLabel={t('importExport.includeAttachments')}
                />
              }
              isFirst={false}
              isLast
            />
          </View>

          <Text variant="titleSmall" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
            {t('importExport.automaticBackups')}
          </Text>
          <GroupedRow
            title={t('importExport.backUpAutomatically')}
            description={autoBackup
              ? t('importExport.autoBackupTo', { folder: folderName(autoBackup.folderUri), count: BACKUPS_KEPT })
              : t('importExport.autoBackupOff', { count: BACKUPS_KEPT })}
            icon="folder-sync-outline"
            onPress={autoBackup ? () => saveAutoBackup(null) : chooseBackupFolder}
            right={
              <M3Switch
                value={!!autoBackup}
                onValueChange={on => (on ? chooseBackupFolder() : saveAutoBackup(null))}
                accessibilityLabel={t('importExport.backUpAutomatically')}
              />
            }
            isFirst
            isLast={!autoBackup}
          />
          {autoBackup && (
            <>
              <GroupedRow
                title={t('importExport.backUpNow')}
                description={backingUp ? t('importExport.backingUp') : backupStatus}
                icon={autoBackup.lastError ? 'alert-circle-outline' : 'backup-restore'}
                danger={!!autoBackup.lastError}
                onPress={() => backUpNow(autoBackup)}
                disabled={backingUp}
                isFirst={false}
                isLast={false}
              />
              <GroupedRow
                title={t('importExport.backupFolder')}
                description={folderName(autoBackup.folderUri)}
                icon="folder-outline"
                onPress={chooseBackupFolder}
                isFirst={false}
                isLast={false}
              />
              <GroupedRow
                title={t('importExport.includeProtected')}
                description={t('importExport.includeProtectedOff')}
                icon="lock-outline"
                onPress={() => setIncludeProtected(!autoBackup.includeProtected)}
                right={
                  <M3Switch
                    value={autoBackup.includeProtected}
                    onValueChange={setIncludeProtected}
                    accessibilityLabel={t('importExport.includeProtected')}
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
                  { value: 'daily', label: t('importExport.everyDay'), icon: 'calendar-today' },
                  { value: 'weekly', label: t('importExport.everyWeek'), icon: 'calendar-week' },
                ]}
              />
              <Text variant="bodySmall" style={[styles.backupHelp, { color: theme.colors.onSurfaceVariant }]}>
                {t('importExport.backupHelp')}
              </Text>
            </>
          )}

          <View style={styles.historyHeader}>
            <Text variant="titleSmall" accessibilityRole="header" style={[styles.historyTitle, { color: theme.colors.primary }]}>{t('importExport.history')}</Text>
            <Menu
              visible={historyMenuVisible}
              onDismiss={() => setHistoryMenuVisible(false)}
              anchor={
                <IconButton
                  icon="dots-vertical"
                  onPress={() => setHistoryMenuVisible(true)}
                  disabled={history.length === 0 || pdfExporting}
                  accessibilityLabel={t('importExport.historyOptions')}
                />
              }
            >
              <Menu.Item
                leadingIcon="file-pdf-box"
                title={t('importExport.saveAsPdf')}
                onPress={() => { setHistoryMenuVisible(false); handleExportHistoryPDF(); }}
              />
              <Menu.Item
                leadingIcon="delete-outline"
                title={t('importExport.clearHistory')}
                titleStyle={{ color: theme.colors.error }}
                onPress={() => { setHistoryMenuVisible(false); clearHistory(); }}
              />
            </Menu>
          </View>
          {history.length === 0 ? (
            <Text variant="bodyMedium" style={[styles.emptyHistory, { color: theme.colors.onSurfaceVariant }]}>
              {t('importExport.emptyHistory')}
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
          <Dialog.Title>{t('importExport.importNotes')}</Dialog.Title>
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
                    {t('importExport.replaceBanner')}
                  </Text>
                </View>
              )}
              {pasteOpen ? (
                <>
                  <TextInput
                    mode="outlined"
                    label={t('importExport.pasteJson')}
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
                    {t('importExport.importPastedJson')}
                  </Button>
                </>
              ) : (
                <>
                  <Button mode="contained" icon="file-upload-outline" theme={controlTheme} onPress={() => { closeImportDialog(); handleFileImport(); }}>
                    {t('importExport.chooseFiles')}
                  </Button>
                  <Button mode="text" icon="content-paste" onPress={() => setPasteOpen(true)}>
                    {t('importExport.pasteInstead')}
                  </Button>
                </>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={closeImportDialog}>{t('common.cancel')}</Button>
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
