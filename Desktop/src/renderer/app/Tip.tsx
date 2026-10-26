import React from 'react';
import { Tooltip, TooltipProps } from 'react-native-paper';
import { useTheme } from '../../../../Mobile/src/theme/ThemeContext';

// Paper draws tooltips in the inverse colors (a light bubble on a dark screen). This one sits on the app's own surfaces,
// like the phone's snackbar: a raised surface with the normal text color, in light and dark.
// electron.vite.config.ts also wraps every icon button of the phone's screens in it (their accessibility label is the text).
const Tip = (props: TooltipProps) => {
  const { theme } = useTheme();
  return <Tooltip {...props} theme={{ colors: { onSurface: theme.colors.surfaceContainerHighest, surface: theme.colors.onSurface } }} />;
};

export default Tip;
