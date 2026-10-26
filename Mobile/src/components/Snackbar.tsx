import React from 'react';
import { Snackbar as PaperSnackbar, SnackbarProps } from 'react-native-paper';
import { useTheme } from '../theme/ThemeContext';
import { shape } from '../theme/theme';

// Unlike Paper's inverse-colored snackbar, this one uses the app's own surfaces.
const Snackbar = (props: SnackbarProps) => {
  const { theme } = useTheme();
  return (
    <PaperSnackbar
      {...props}
      theme={{
        colors: {
          inverseSurface: theme.colors.surfaceContainerHighest,
          inverseOnSurface: theme.colors.onSurface,
          inversePrimary: theme.colors.primary,
        },
      }}
      style={[{ borderRadius: shape.control }, props.style]}
    />
  );
};

export default Snackbar;
