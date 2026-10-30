import React, { createContext, useCallback, useContext, useState } from 'react';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { useI18n } from '../i18n/I18nContext';

type DialogButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type DialogOptions = { cancelable?: boolean };
type AlertFn = (title: string, message?: string, buttons?: DialogButton[], options?: DialogOptions) => void;
type Queued = { title: string; message?: string; buttons: DialogButton[]; cancelable: boolean };

const DialogContext = createContext<AlertFn>(() => {});

// Same call shape as Alert.alert, drawn as a Paper dialog so it follows the app theme.
export const useAlert = () => useContext(DialogContext);

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  // A queue, because a button's onPress often opens the next dialog (confirm, then result).
  const [queue, setQueue] = useState<Queued[]>([]);
  const current = queue[0];

  const alert = useCallback<AlertFn>((title, message, buttons, options) => {
    const list = buttons?.length ? buttons : [{ text: t('common.ok') }];
    setQueue(q => [...q, { title, message, buttons: list, cancelable: options?.cancelable !== false }]);
  }, [t]);

  const close = (button?: DialogButton) => {
    setQueue(q => q.slice(1));
    button?.onPress?.();
  };

  // Tapping outside or pressing back counts as the cancel button, like a native alert.
  const cancelButton = current?.buttons.find(b => b.style === 'cancel');
  const dismissable = !!current && current.cancelable && (!!cancelButton || current.buttons.length === 1);

  return (
    <DialogContext.Provider value={alert}>
      {children}
      <Portal>
        {/* Keep these direct children: Dialog passes each a style prop, which a Fragment can't take. */}
        <Dialog visible={!!current} dismissable={dismissable} onDismiss={() => close(cancelButton)}>
          {current && <Dialog.Title>{current.title}</Dialog.Title>}
          {!!current?.message && (
            <Dialog.Content>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{current.message}</Text>
            </Dialog.Content>
          )}
          {current && (
            <Dialog.Actions>
              {current.buttons.map(b => (
                <Button
                  key={b.text}
                  textColor={b.style === 'destructive' ? theme.colors.error : undefined}
                  onPress={() => close(b)}
                >
                  {b.text}
                </Button>
              ))}
            </Dialog.Actions>
          )}
        </Dialog>
      </Portal>
    </DialogContext.Provider>
  );
};
