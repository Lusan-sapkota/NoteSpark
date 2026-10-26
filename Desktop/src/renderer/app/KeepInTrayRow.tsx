import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupedRow from '../../../../Mobile/src/components/GroupedRow';
import M3Switch from '../../../../Mobile/src/components/M3Switch';

// A Settings row only the desktop has: electron.vite.config.ts adds it to the phone's Settings screen.
// src/main/index.ts reads `keepInTray` (on unless it is "false") when the window closes.
const KeepInTrayRow = () => {
  const [on, setOn] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('keepInTray').then(value => setOn(value !== 'false'), () => {});
  }, []);
  const change = (next: boolean) => {
    setOn(next);
    AsyncStorage.setItem('keepInTray', String(next)).catch(() => {});
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
