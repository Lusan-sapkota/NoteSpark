import React, { useCallback, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, StyleSheet, View } from 'react-native';
import { Appbar, Icon, Text } from 'react-native-paper';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';

interface HeaderProps {
  title: string;
  showBackButton?: boolean;
  onBackPress?: () => void;
  rightActions?: React.ReactNode;
  elevated?: boolean;
  // Makes the title a button with a chevron (the profile switcher). `titleLabel` is what a screen reader says for it.
  onTitlePress?: () => void;
  titleLabel?: string;
  // A note's colour; the bar then keeps it even while content scrolls under.
  backgroundColor?: string;
}

// M3 small top app bar; `elevated` tints it to surfaceContainer while content scrolls under it.
const Header: React.FC<HeaderProps> = ({
  title,
  showBackButton = false,
  onBackPress,
  rightActions,
  elevated = false,
  onTitlePress,
  titleLabel,
  backgroundColor,
}) => {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <Appbar.Header mode="small" elevated={elevated && !backgroundColor} style={backgroundColor ? { backgroundColor } : undefined}>
      {showBackButton && <Appbar.BackAction onPress={onBackPress} accessibilityLabel={t('common.back')} />}
      {onTitlePress ? (
        // The name takes the room the icons leave and ends in an ellipsis; the chevron never shrinks, so it is always there.
        <View style={styles.titleSlot}>
          <Pressable onPress={onTitlePress} accessibilityRole="button" accessibilityLabel={titleLabel ?? title} style={styles.switcher}>
            <Text variant="titleLarge" numberOfLines={1} style={[styles.switcherText, { color: theme.colors.onSurface }]}>{title}</Text>
            <View style={styles.chevron}><Icon source="chevron-down" size={24} color={theme.colors.onSurfaceVariant} /></View>
          </Pressable>
        </View>
      ) : (
        <Appbar.Content title={title} />
      )}
      {rightActions}
    </Appbar.Header>
  );
};

const styles = StyleSheet.create({
  titleSlot: { flex: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  switcher: { flexShrink: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  switcherText: { flexShrink: 1 },
  chevron: { flexShrink: 0, marginLeft: 4 },
});

// Pass `onScroll` to the screen's scroll view and `elevated` to its Header.
export const useHeaderElevation = () => {
  const [elevated, setElevated] = useState(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setElevated(e.nativeEvent.contentOffset.y > 0);
  }, []);
  return { elevated, onScroll };
};

export default Header;
