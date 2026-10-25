import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, TextInput } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { readingWidth, space } from '../theme/theme';
import { StyleSheet, View } from 'react-native';

const ProfileUnlockScreen = ({ profileName, onUnlock }: { profileName: string; onUnlock: (pin: string) => Promise<boolean> }) => {
  const { theme } = useTheme();
  const [pin, setPin] = useState('');
  const [invalid, setInvalid] = useState(false);

  const unlock = async () => {
    const success = await onUnlock(pin);
    setInvalid(!success);
    if (success) setPin('');
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
          onChangeText={value => { setPin(value.replace(/\D/g, '').slice(0, 4)); setInvalid(false); }}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          error={invalid}
          onSubmitEditing={unlock}
        />
        {invalid && <Text variant="bodySmall" style={{ color: theme.colors.error }}>Incorrect PIN. Try again.</Text>}
        <Button mode="contained" onPress={unlock} disabled={pin.length !== 4} style={styles.button}>Unlock</Button>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center', padding: space.xl, justifyContent: 'center' },
  body: { marginTop: space.md, marginBottom: space.xl },
  button: { marginTop: space.xl, alignSelf: 'flex-start' },
});

export default ProfileUnlockScreen;
