// react-native for the desktop renderer: react-native-web, plus the bits of the native API it lacks that the phone's
// screens call.
import React from 'react';
import { TextInput as WebTextInput } from 'react-native-web';

export * from 'react-native-web';

// The editor moves the cursor with ref.setSelection(start, end), which only native TextInput has.
export const TextInput = React.forwardRef<any, any>((props, ref) => (
  <WebTextInput
    {...props}
    ref={(node: any) => {
      if (node && !node.setSelection) node.setSelection = (start: number, end: number) => node.setSelectionRange?.(start, end);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }}
  />
));

// The hardware back button is an Android thing; the phone's Menu listens for it.
export const BackHandler = {
  addEventListener: (_event: string, _handler: () => boolean) => ({ remove: () => {} }),
  removeEventListener: () => {},
  exitApp: () => {},
};
