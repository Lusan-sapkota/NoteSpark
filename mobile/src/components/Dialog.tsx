import React from 'react';
import { useWindowDimensions } from 'react-native';
import { Dialog as PaperDialog } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Paper's Dialog fills the screen width, so it grows huge on a tablet or desktop. Material 3 caps a dialog at 560 dp.
// A number goes in `width`, not `maxWidth`: Paper's Surface puts `width` on its outer shadow layer but `maxWidth` only on the
// inner one, which left an oversized box behind the dialog.
const Dialog = Object.assign(
  ({ style, ...props }: React.ComponentProps<typeof PaperDialog>) => {
    const { width } = useWindowDimensions();
    const { left, right } = useSafeAreaInsets();
    // Paper keeps this margin on both sides, so a phone dialog stays exactly as wide as before.
    const margin = Math.max(left, right, 26);
    return <PaperDialog {...props} style={[{ width: Math.min(560, width - 2 * margin), alignSelf: 'center' }, style]} />;
  },
  { Title: PaperDialog.Title, Content: PaperDialog.Content, Actions: PaperDialog.Actions, ScrollArea: PaperDialog.ScrollArea, Icon: PaperDialog.Icon },
);

export default Dialog;
