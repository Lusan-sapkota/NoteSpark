import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import Dialog from './Dialog';
import KeyboardSafePortal from './KeyboardSafePortal';
import { useAlert } from './DialogProvider';
import { useI18n } from '../i18n/I18nContext';
import { space } from '../theme/theme';
import { Profile, unlockWithBiometrics, verifyProfilePin, wrongPinMessage } from '../storage/profiles';

// Opens a profile for one action: no PIN, free; a fingerprint when the profile uses one; otherwise its PIN, asked here until it
// is right (too many wrong ones lock it for a while, see wrongPinMessage). `ask` resolves { pin } (empty when the fingerprint
// or no PIN was needed), or null when the person cancels. Render `dialog` somewhere on the screen.
export const useProfileUnlock = () => {
  const { t } = useI18n();
  const alert = useAlert();
  const [state, setState] = useState<{ profile: Profile; title: string; pin: string } | null>(null);
  const done = useRef<((r: { pin: string } | null) => void) | null>(null);

  const finish = useCallback((result: { pin: string } | null) => {
    setState(null);
    done.current?.(result);
    done.current = null;
  }, []);

  const ask = useCallback(async (profile: Profile, title: string): Promise<{ pin: string } | null> => {
    if (await verifyProfilePin(profile.id, '')) return { pin: '' };
    if (await unlockWithBiometrics(profile)) return { pin: '' };
    return new Promise(resolve => {
      done.current = resolve;
      setState({ profile, title, pin: '' });
    });
  }, []);

  const submit = async () => {
    if (!state || state.pin.length !== 4) return;
    if (!(await verifyProfilePin(state.profile.id, state.pin))) {
      alert(t('home.incorrectPin'), await wrongPinMessage(state.profile.id));
      return;
    }
    finish({ pin: state.pin });
  };

  const dialog = (
    <KeyboardSafePortal>
      <Dialog visible={!!state} onDismiss={() => finish(null)}>
        <Dialog.Title>{state?.title}</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">{t('home.enterPin', { name: state?.profile.name ?? '' })}</Text>
          <TextInput
            mode="outlined"
            label={t('home.pin')}
            value={state?.pin ?? ''}
            onChangeText={pin => setState(s => s && { ...s, pin: pin.replace(/\D/g, '').slice(0, 4) })}
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            onSubmitEditing={submit}
            style={styles.input}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => finish(null)}>{t('common.cancel')}</Button>
          <Button onPress={submit} disabled={state?.pin.length !== 4}>{t('home.unlock')}</Button>
        </Dialog.Actions>
      </Dialog>
    </KeyboardSafePortal>
  );

  return { ask, dialog };
};

const styles = StyleSheet.create({ input: { marginTop: space.md } });
