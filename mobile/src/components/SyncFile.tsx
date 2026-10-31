import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, HelperText, Portal, Text, TextInput } from 'react-native-paper';
import GroupedRow from './GroupedRow';
import M3Switch from './M3Switch';
import Snackbar from './Snackbar';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { controlTheme, space } from '../theme/theme';
import { type PlanView, asFailure, syncFileBackend as backend } from '../utils/syncFile';

type Dialog = 'export' | 'open' | 'preview' | 'other' | null;
const MIN_PASSPHRASE = 8;

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Export and Import of the sync file: moving a profile between devices by hand, with no network. Passphrases live only in this
// component's state while a dialog is open; they are never stored or logged. The work itself is in `backend` (utils/syncFile.ts).
const SyncFile: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState('');
  const [summary, setSummary] = useState({ notes: 0, attachments: 0, attachmentBytes: 0 });
  const [withFiles, setWithFiles] = useState(true);
  const [plan, setPlan] = useState<PlanView | null>(null);

  const close = () => { backend.clear(); setDialog(null); setPass(''); setAgain(''); setError(''); setPlan(null); setBusy(false); };

  const explain = (e: unknown, exporting = false) => {
    const { reason } = asFailure(e);
    if (reason === 'passphrase') return t('sync.fileWrong');
    if (reason === 'version') return t('sync.fileNewer');
    if (reason === 'tooBig') return exporting ? t('sync.fileTooBig') : t('sync.fileLarge');
    return t('sync.fileNotSync');
  };

  const openExport = async () => {
    setError('');
    const found = await backend.summary();
    setSummary(found);
    setWithFiles(found.attachments > 0);
    setDialog('export');
  };

  const doExport = async () => {
    if (pass.length < MIN_PASSPHRASE) return setError(t('sync.filePassphraseShort'));
    if (pass !== again) return setError(t('sync.filePassphraseMismatch'));
    setBusy(true);
    try {
      const saved = await backend.exportFile(pass, withFiles);
      close();
      if (saved) setSnackbar(t('sync.fileSaved'));
    } catch (e) {
      setError(explain(e, true));
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      if (!(await backend.pickFile())) return;
      setError('');
      setDialog('open');
    } catch {
      setSnackbar(t('sync.fileNotSync'));
    }
  };

  const doOpen = async () => {
    setBusy(true);
    setError('');
    try {
      const found = await backend.plan(pass);
      setPlan(found);
      setDialog(found.kind === 'otherProfile' ? 'other' : 'preview');
    } catch (e) {
      setError(explain(e));
    }
    setBusy(false);
  };

  const doImport = async (asNewProfile = false) => {
    setBusy(true);
    try {
      await backend.run(asNewProfile);
      close();
      setSnackbar(t('sync.fileImported'));
    } catch (e) {
      setError(explain(e));
      setBusy(false);
    }
  };

  const passFields = (confirm: boolean) => (
    <View style={styles.fields}>
      <TextInput mode="outlined" label={t('sync.filePassphrase')} value={pass} onChangeText={v => { setPass(v); setError(''); }} secureTextEntry autoCapitalize="none" autoCorrect={false} error={!!error} />
      {confirm && <TextInput mode="outlined" label={t('sync.filePassphraseAgain')} value={again} onChangeText={v => { setAgain(v); setError(''); }} secureTextEntry autoCapitalize="none" autoCorrect={false} error={!!error} />}
      {confirm && !error && <HelperText type="info" visible>{t('sync.filePassphraseHelp')}</HelperText>}
      {!!error && <HelperText type="error" visible>{error}</HelperText>}
    </View>
  );

  if (!backend.available) return null; // the web view in a browser has no file dialogs

  return (
    <View>
      <Text variant="titleSmall" accessibilityRole="header" style={[styles.heading, { color: theme.colors.primary }]}>{t('sync.fileHeading')}</Text>
      <GroupedRow title={t('sync.fileExport')} description={t('sync.fileExportHelp')} icon="file-export-outline" onPress={openExport} isFirst isLast={false} />
      <GroupedRow title={t('sync.fileImport')} description={t('sync.fileImportHelp')} icon="file-import-outline" onPress={pick} isFirst={false} isLast />

      <Portal>
        <Dialog visible={dialog === 'export'} onDismiss={busy ? undefined : close}>
          <Dialog.Title>{t('sync.fileExport')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {t('sync.fileSummary', { notes: summary.notes, count: withFiles ? summary.attachments : 0, size: size(withFiles ? summary.attachmentBytes : 0) })}
            </Text>
            {summary.attachments > 0 && (
              <GroupedRow title={t('sync.fileInclude')} icon="paperclip" onPress={() => setWithFiles(v => !v)} right={<M3Switch value={withFiles} onValueChange={setWithFiles} accessibilityLabel={t('sync.fileInclude')} />} isFirst isLast />
            )}
            {passFields(true)}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={close} disabled={busy}>{t('common.cancel')}</Button>
            <Button mode="contained" theme={controlTheme} onPress={doExport} loading={busy} disabled={busy || !pass || !again}>{t('sync.fileExportAction')}</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={dialog === 'open'} onDismiss={busy ? undefined : close}>
          <Dialog.Title>{t('sync.fileOpenTitle')}</Dialog.Title>
          <Dialog.Content>{passFields(false)}</Dialog.Content>
          <Dialog.Actions>
            <Button onPress={close} disabled={busy}>{t('common.cancel')}</Button>
            <Button mode="contained" theme={controlTheme} onPress={doOpen} loading={busy} disabled={busy || !pass}>{t('sync.fileOpenAction')}</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={dialog === 'preview'} onDismiss={busy ? undefined : close}>
          <Dialog.Title>{t('sync.fileJoinTitle')}</Dialog.Title>
          <Dialog.Content>
            {plan && <Text variant="bodyMedium">{plan.kind === 'adopt' ? t('sync.fileJoinBody', { here: plan.localNotes, there: plan.fileNotes, same: plan.same }) : t('sync.fileMergeBody', { here: plan.localNotes, there: plan.fileNotes })}</Text>}
            {plan && plan.attachments > 0 && <Text variant="bodyMedium">{t('sync.fileAttachments', { count: plan.attachments })}</Text>}
            {!!error && <HelperText type="error" visible>{error}</HelperText>}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={close} disabled={busy}>{t('common.cancel')}</Button>
            <Button mode="contained" theme={controlTheme} onPress={() => doImport()} loading={busy} disabled={busy}>{t('sync.fileImportAction')}</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={dialog === 'other'} onDismiss={busy ? undefined : close}>
          <Dialog.Title>{t('sync.fileOtherTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('sync.fileOtherBody', { name: plan?.fileName ?? '' })}</Text>
            {!!error && <HelperText type="error" visible>{error}</HelperText>}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={close} disabled={busy}>{t('common.cancel')}</Button>
            <Button mode="contained" theme={controlTheme} onPress={() => doImport(true)} loading={busy} disabled={busy}>{t('sync.fileOtherAction')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={!!snackbar} onDismiss={() => setSnackbar('')} duration={4000}>{snackbar}</Snackbar>
    </View>
  );
};

const styles = StyleSheet.create({
  heading: { marginTop: space.xl, marginBottom: space.sm, paddingHorizontal: space.xs },
  fields: { gap: space.sm, marginTop: space.md },
});

export default SyncFile;
