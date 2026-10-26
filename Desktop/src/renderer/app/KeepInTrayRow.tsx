import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupedRow from '../../../../Mobile/src/components/GroupedRow';
import M3Switch from '../../../../Mobile/src/components/M3Switch';
import { isDesktop } from './bridge';

// Desktop-only Settings rows; the settings channel refuses keys containing pin/key/secret/token/backup, so not "keepInTray".
export const MENU_BUTTON_CHANGED = 'notespark:menu-button';
export const canShowMenuButton = isDesktop && !/Mac/.test(navigator.userAgent);

const MenuButtonRow = () => {
  const [on, setOn] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('menuButton').then(value => setOn(value !== 'false'), () => {});
  }, []);
  const change = (next: boolean) => {
    setOn(next);
    AsyncStorage.setItem('menuButton', String(next)).catch(() => {});
    window.dispatchEvent(new Event(MENU_BUTTON_CHANGED));
  };
  return (
    <GroupedRow
      title="Show menu button in the header"
      description="Turn off if your desktop already shows the menu at the top of the screen."
      icon="menu"
      right={<M3Switch value={on} onValueChange={change} accessibilityLabel="Show menu button in the header" />}
      onPress={() => change(!on)}
      isFirst={false}
      isLast
    />
  );
};

const TrayRow = ({ isLast }: { isLast: boolean }) => {
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
      title="Keep running in the tray"
      description="Closing the window keeps NoteSpark running. Quit from the tray icon."
      icon="tray-full"
      right={<M3Switch value={on} onValueChange={change} accessibilityLabel="Keep running in the tray" />}
      onPress={() => change(!on)}
      isFirst={false}
      isLast={isLast}
    />
  );
};

const KeepInTrayRow = () => (
  <>
    <TrayRow isLast={!canShowMenuButton} />
    {canShowMenuButton && <MenuButtonRow />}
  </>
);

export default KeepInTrayRow;
