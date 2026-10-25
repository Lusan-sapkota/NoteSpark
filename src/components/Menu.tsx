import React, { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { Menu as PaperMenu, MenuProps } from 'react-native-paper';

// Paper's Menu closes on back but doesn't consume the press, so Android also goes back a screen
// (or leaves the app on Home). This one closes the menu and stops there.
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
