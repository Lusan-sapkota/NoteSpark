import React, { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { Menu as PaperMenu, MenuProps } from 'react-native-paper';

// Paper's Menu doesn't consume the back press, so Android also left the screen (or the app).
const Menu = (props: MenuProps) => {
  const { visible, onDismiss } = props;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, onDismiss]);
  return <PaperMenu {...props} />;
};

Menu.Item = PaperMenu.Item;

export default Menu;
