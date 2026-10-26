import { Tooltip, TooltipProps } from 'react-native-paper';
import { useTheme } from '../../../../Mobile/src/theme/ThemeContext';

// Tooltip on the app's own surface colors (Paper's is inverse); electron.vite.config.ts wraps icon buttons in it.
const Tip = (props: TooltipProps) => {
  const { theme } = useTheme();
  return <Tooltip {...props} theme={{ colors: { onSurface: theme.colors.surfaceContainerHighest, surface: theme.colors.onSurface } }} />;
};

export default Tip;
