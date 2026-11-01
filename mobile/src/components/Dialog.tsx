import React from 'react';
import { Dialog as PaperDialog } from 'react-native-paper';

// Paper's Dialog fills the screen width, so it grows huge on a tablet or desktop. Material 3 caps a dialog at 560 dp.
const Dialog = Object.assign(
  ({ style, ...props }: React.ComponentProps<typeof PaperDialog>) => (
    <PaperDialog {...props} style={[{ width: '100%', maxWidth: 560, alignSelf: 'center' }, style]} />
  ),
  { Title: PaperDialog.Title, Content: PaperDialog.Content, Actions: PaperDialog.Actions, ScrollArea: PaperDialog.ScrollArea, Icon: PaperDialog.Icon },
);

export default Dialog;
