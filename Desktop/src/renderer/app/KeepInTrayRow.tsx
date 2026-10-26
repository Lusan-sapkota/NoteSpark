import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupedRow from '../../../../Mobile/src/components/GroupedRow';
import M3Switch from '../../../../Mobile/src/components/M3Switch';

// Desktop-only Settings row; the settings channel refuses keys containing pin/key/secret/token/backup, so not "keepInTray".
const KeepInTrayRow = () => {
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
      isLast
    />
  );
};

export default KeepInTrayRow;
