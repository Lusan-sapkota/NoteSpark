// The phone's Menu (Mobile/src/components/Menu.tsx) wraps Paper's Menu. Paper's Menu runs its "hide" routine when it
// mounts, and on the web that moves keyboard focus to the anchor. A note list has a closed menu on every row: mounting
// them scrolled the list, which mounted more rows, which scrolled again, a loop that cost a third of a core at idle.
// Here Paper's Menu is only mounted once the menu has been opened for the first time (a closed menu is just its anchor,
// which is also much cheaper per row).
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
