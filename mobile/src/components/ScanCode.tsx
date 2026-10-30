import React, { useRef } from 'react';
import { Linking, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Text } from 'react-native-paper';
import Header from './Header';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import { controlTheme, readingWidth, shape, space } from '../theme/theme';

interface Props { visible: boolean; onCode: (text: string) => void; onClose: () => void }

// Reads one pairing QR. The camera permission is asked here, when the person taps Scan, never at start. Nothing is recorded or kept.
const ScanCode: React.FC<Props> = ({ visible, onCode, onClose }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} onShow={() => { done.current = false; }}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
        <Header title={t('sync.scan')} showBackButton onBackPress={onClose} />
        <View style={styles.column}>
          {permission?.granted ? (
            <>
              <View style={[styles.camera, { backgroundColor: theme.colors.surfaceContainerHighest }]}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }) => {
                    if (done.current || !data.toLowerCase().startsWith('notespark://pair')) return; // other codes are ignored
                    done.current = true;
                    onCode(data);
                  }}
                />
              </View>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('sync.scanHelp')}</Text>
            </>
          ) : (
            <>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
                {permission && !permission.canAskAgain ? t('sync.cameraDenied') : t('sync.cameraWhy')}
              </Text>
              {permission && !permission.canAskAgain ? (
                <Button mode="contained" theme={controlTheme} style={styles.button} contentStyle={styles.buttonContent} onPress={() => Linking.openSettings()}>{t('sync.openSettings')}</Button>
              ) : (
                <Button mode="contained" theme={controlTheme} style={styles.button} contentStyle={styles.buttonContent} onPress={requestPermission}>{t('sync.allowCamera')}</Button>
              )}
              <Button onPress={onClose}>{t('sync.pasteInstead')}</Button>
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.lg, gap: space.lg },
  camera: { width: '100%', aspectRatio: 1, borderRadius: shape.group, overflow: 'hidden' },
  button: { alignSelf: 'stretch' },
  buttonContent: { minHeight: 48 },
});

export default ScanCode;
