import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Menu, IconButton } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';

interface HeaderProps {
  title: string;
  showBackButton?: boolean;
  onBackPress?: () => void;
  rightActions?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({
  title,
  showBackButton = false,
  onBackPress,
  rightActions,
}) => {
  const { theme, themeType, setThemeType } = useTheme();
  const [menuVisible, setMenuVisible] = React.useState(false);

  const toggleMenu = () => setMenuVisible(!menuVisible);
  const closeMenu = () => setMenuVisible(false);

  const handleThemeChange = (type: 'light' | 'dark' | 'system') => {
    setThemeType(type);
    closeMenu();
  };

  return (
    <Appbar.Header
      style={{ backgroundColor: theme.colors.surface }}
    >
      {showBackButton && (
        <Appbar.BackAction
          onPress={onBackPress}
          color={theme.colors.primary}
        />
      )}
      <Appbar.Content
        title={title}
        titleStyle={{ color: theme.colors.primary, fontWeight: 'bold' }}
      />
      {rightActions}
      <Menu
        visible={menuVisible}
        onDismiss={closeMenu}
        anchor={
          <IconButton
            icon="theme-light-dark"
            iconColor={theme.colors.primary}
            size={24}
            onPress={toggleMenu}
          />
        }
      >
        <Menu.Item
          leadingIcon="white-balance-sunny"
          onPress={() => handleThemeChange('light')}
          title="Light Theme"
          trailingIcon={themeType === 'light' ? 'check' : undefined}
        />
        <Menu.Item
          leadingIcon="weather-night"
          onPress={() => handleThemeChange('dark')}
          title="Dark Theme"
          trailingIcon={themeType === 'dark' ? 'check' : undefined}
        />
        <Menu.Item
          leadingIcon="theme-light-dark"
          onPress={() => handleThemeChange('system')}
          title="System Default"
          trailingIcon={themeType === 'system' ? 'check' : undefined}
        />
      </Menu>
    </Appbar.Header>
  );
};

export default Header; 