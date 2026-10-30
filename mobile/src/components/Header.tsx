import React, { useCallback, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Appbar } from 'react-native-paper';

interface HeaderProps {
  title: string;
  showBackButton?: boolean;
  onBackPress?: () => void;
  rightActions?: React.ReactNode;
  elevated?: boolean;
}

// M3 small top app bar; `elevated` tints it to surfaceContainer while content scrolls under it.
const Header: React.FC<HeaderProps> = ({
  title,
  showBackButton = false,
  onBackPress,
  rightActions,
  elevated = false,
}) => (
  <Appbar.Header mode="small" elevated={elevated}>
    {showBackButton && <Appbar.BackAction onPress={onBackPress} accessibilityLabel="Back" />}
    <Appbar.Content title={title} />
    {rightActions}
  </Appbar.Header>
);

// Pass `onScroll` to the screen's scroll view and `elevated` to its Header.
export const useHeaderElevation = () => {
  const [elevated, setElevated] = useState(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setElevated(e.nativeEvent.contentOffset.y > 0);
  }, []);
  return { elevated, onScroll };
};

export default Header;
