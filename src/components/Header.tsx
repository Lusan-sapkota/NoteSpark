import React from 'react';
import { Appbar } from 'react-native-paper';

interface HeaderProps {
  title: string;
  showBackButton?: boolean;
  onBackPress?: () => void;
  rightActions?: React.ReactNode;
}

// M3 small top app bar. Colors and the status bar inset come from Paper and the safe area.
const Header: React.FC<HeaderProps> = ({
  title,
  showBackButton = false,
  onBackPress,
  rightActions,
}) => (
  <Appbar.Header mode="small">
    {showBackButton && <Appbar.BackAction onPress={onBackPress} accessibilityLabel="Back" />}
    <Appbar.Content title={title} />
    {rightActions}
  </Appbar.Header>
);

export default Header;
