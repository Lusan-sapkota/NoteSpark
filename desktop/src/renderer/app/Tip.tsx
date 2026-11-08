import React from 'react';
import { Tooltip, TooltipProps } from 'react-native-paper';
import { useTheme } from '../../../../mobile/src/theme/ThemeContext';

// Tooltip on the app's own surface colors (Paper's is inverse); electron.vite.config.ts wraps icon buttons in it.
// A press remounts it: when the click moves the button (a toolbar row opens, a menu closes) no mouse-leave arrives and the tip stays up.
const Tip = ({ children, ...props }: TooltipProps) => {
  const { theme } = useTheme();
  const [round, setRound] = React.useState(0);
  const onPress = (children.props as { onPress?: (...a: unknown[]) => unknown }).onPress;
  return (
    <Tooltip key={round} {...props} theme={{ colors: { onSurface: theme.colors.surfaceContainerHighest, surface: theme.colors.onSurface } }}>
      {onPress ? React.cloneElement(children, { onPress: (...a: unknown[]) => { onPress(...a); setRound(r => r + 1); } } as object) : children}
    </Tooltip>
  );
};

export default Tip;
