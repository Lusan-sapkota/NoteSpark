import React, { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, TextInput } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { useAlert } from '../components/DialogProvider';
import { canUseBiometrics, getPinLockout, unlockWithBiometrics, usesBiometrics, wrongPinMessage } from '../storage/profiles';
import { readingWidth, space } from '../theme/theme';
import { StyleSheet, View } from 'react-native';

const ProfileUnlockScreen = ({ profileId, profileName, onUnlock, onForgotPin }: { profileId: string; profileName: string; onUnlock: (pin: string) => Promise<boolean>; onForgotPin: () => Promise<void> }) => {
  const { theme } = useTheme();
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
    setError(success ? '' : (await getPinLockout(profileId)) ? await wrongPinMessage(profileId) : 'Incorrect PIN. Try again.');
    setPin('');
  };

  // The PIN can't be recovered, so the only way back in is erasing this profile.
  const forgotPin = () => {
    alert(
      'Erase this profile?',
      `A forgotten PIN can't be recovered. To use NoteSpark again, ${profileName} and all its notes will be erased from this device. Your other profiles stay as they are. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase profile',
          style: 'destructive',
          onPress: () => onForgotPin().catch(() => alert("Couldn't erase the profile", 'Restart the app and try again.')),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.column}>
        <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>Unlock {profileName}</Text>
        <Text variant="bodyLarge" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
          Enter the four-digit PIN for the default profile.
        </Text>
        <TextInput
          mode="outlined"
          label="Profile PIN"
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
          <Button mode="contained" onPress={unlock} disabled={pin.length !== 4}>Unlock</Button>
          {fingerprint && <Button icon="fingerprint" onPress={() => unlockWithFingerprint().catch(() => {})}>Use fingerprint</Button>}
          <Button onPress={forgotPin}>Forgot PIN?</Button>
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
