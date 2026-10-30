import { useEffect, useState } from 'react';
import { List } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupedRow from '../../../../mobile/src/components/GroupedRow';
import M3Switch from '../../../../mobile/src/components/M3Switch';
import { useAlert } from '../../../../mobile/src/components/DialogProvider';
import { useI18n } from '../../../../mobile/src/i18n/I18nContext';
import { isDesktop } from './bridge';
import { useNavigation } from './nav';
import { text } from './syncText';

// Desktop-only Settings rows; the settings channel refuses keys containing pin/key/secret/token/backup, so not "keepInTray".
export const MENU_BUTTON_CHANGED = 'notespark:menu-button';
export const canShowMenuButton = isDesktop && !/Mac/.test(navigator.userAgent);

const MenuButtonRow = ({ isLast }: { isLast: boolean }) => {
  const { t } = useI18n();
  const [on, setOn] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('menuButton').then(value => setOn(value !== 'false'), () => {});
  }, []);
  const alert = useAlert();
  const save = (next: boolean) => {
    setOn(next);
    AsyncStorage.setItem('menuButton', String(next)).catch(() => {});
    window.dispatchEvent(new Event(MENU_BUTTON_CHANGED));
  };
  // Hiding it can leave no way to the menu, so it asks first.
  const change = (next: boolean) => {
    if (next) return save(true);
    alert(t('desktop.hideMenuTitle'), t('desktop.hideMenuMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('desktop.hideButton'), onPress: () => save(false) },
    ]);
  };
  return (
    <GroupedRow
      title={t('desktop.showMenuButton')}
      description={t('desktop.showMenuButtonHelp')}
      icon="menu"
      right={<M3Switch value={on} onValueChange={change} accessibilityLabel={t('desktop.showMenuButton')} />}
      onPress={() => change(!on)}
      isFirst={false}
      isLast={isLast}
    />
  );
};

const TrayRow = ({ isLast }: { isLast: boolean }) => {
  const { t } = useI18n();
  const [on, setOn] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('trayOnClose').then(value => setOn(value !== 'false'), () => {});
  }, []);
  const change = (next: boolean) => {
    setOn(next);
    AsyncStorage.setItem('trayOnClose', String(next)).catch(() => {});
  };
  return (
    <GroupedRow
      title={t('desktop.keepInTray')}
      description={t('desktop.keepInTrayHelp')}
      icon="tray-full"
      right={<M3Switch value={on} onValueChange={change} accessibilityLabel={t('desktop.keepInTray')} />}
      onPress={() => change(!on)}
      isFirst={false}
      isLast={isLast}
    />
  );
};

// Sync is for the desktop window only: its channel does not exist over the web view.
const SyncRow = () => {
  const navigation = useNavigation<any>();
  return <GroupedRow title={text.settingsRow} description={text.settingsRowHelp} icon="sync" onPress={() => navigation.navigate('Sync')} right={<List.Icon icon="chevron-right" />} isFirst={false} isLast />;
};

const KeepInTrayRow = () => (
  <>
    <TrayRow isLast={false} />
    {canShowMenuButton && <MenuButtonRow isLast={false} />}
    {isDesktop && <SyncRow />}
  </>
);

export default KeepInTrayRow;
