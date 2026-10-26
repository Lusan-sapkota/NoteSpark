// Mounts Paper's Menu only after first open: on web its mount steals focus, and per-row menus caused a scroll loop.
import { useState } from 'react';
import { View } from 'react-native';
import { Menu as PaperMenu, MenuProps } from 'react-native-paper';

const Menu = (props: MenuProps) => {
  const [opened, setOpened] = useState(!!props.visible);
  if (props.visible && !opened) setOpened(true);
  return opened ? <PaperMenu {...props} /> : <View collapsable={false}>{props.anchor}</View>;
};

Menu.Item = PaperMenu.Item;

export default Menu;
