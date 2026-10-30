import React, { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, TextInput } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { useAlert } from '../components/DialogProvider';
import { useI18n } from '../i18n/I18nContext';
import { canUseBiometrics, getPinLockout, unlockWithBiometrics, usesBiometrics, wrongPinMessage } from '../storage/profiles';
import { readingWidth, space } from '../theme/theme';
import { StyleSheet, View } from 'react-native';

const ProfileUnlockScreen = ({ profileId, profileName, onUnlock, onForgotPin }: { profileId: string; profileName: string; onUnlock: (pin: string) => Promise<boolean>; onForgotPin: () => Promise<void> }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const alert = useAlert();
  const [pin, setPin] = useState('');
  // Shown under the field after a refused PIN: wrong, or locked after too many tries.
  const [error, setError] = useState('');
  const [fingerprint, setFingerprint] = useState(false);

  const unlockWithFingerprint = async () => {
    if (await unlockWithBiometrics({ id: profileId, name: profileName })) await onUnlock('');
  };

  // Asks for the fingerprint straight away when it's on; "Use PIN" falls back to the field.
  useEffect(() => {
    (async () => {
      const on = (await usesBiometrics(profileId)) && (await canUseBiometrics());
      setFingerprint(on);
      if (on) await unlockWithFingerprint();
    })().catch(() => {});
  }, [profileId]);

  const unlock = async () => {
    const success = await onUnlock(pin);
    setError(success ? '' : (await getPinLockout(profileId)) ? await wrongPinMessage(profileId) : t('profiles.incorrectPinTryAgain'));
    setPin('');
  };

  // The PIN can't be recovered, so the only way back in is erasing this profile.
  const forgotPin = () => {
    alert(
      t('profiles.eraseTitle'),
      t('profiles.eraseBodyUnlock', { name: profileName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profiles.eraseAction'),
          style: 'destructive',
          onPress: () => onForgotPin().catch(() => alert(t('profiles.eraseFailed'), t('profiles.eraseFailedRestart'))),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column}>
        <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>{t('profiles.unlockTitle', { name: profileName })}</Text>
        <Text variant="bodyLarge" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
          {t('profiles.unlockBody')}
        </Text>
        <TextInput
          mode="outlined"
          label={t('profiles.profilePin')}
          value={pin}
          onChangeText={value => { setPin(value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          error={!!error}
          onSubmitEditing={unlock}
        />
        {!!error && <Text variant="bodySmall" style={{ color: theme.colors.error }} accessibilityLiveRegion="polite">{error}</Text>}
        <View style={styles.actions}>
          <Button mode="contained" onPress={unlock} disabled={pin.length !== 4}>{t('profiles.unlock')}</Button>
          {fingerprint && <Button icon="fingerprint" onPress={() => unlockWithFingerprint().catch(() => {})}>{t('profiles.useFingerprint')}</Button>}
          <Button onPress={forgotPin}>{t('profiles.forgotPin')}</Button>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl, justifyContent: 'center' },
  body: { marginTop: space.md, marginBottom: space.xl },
  actions: { marginTop: space.xl, flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

export default ProfileUnlockScreen;
