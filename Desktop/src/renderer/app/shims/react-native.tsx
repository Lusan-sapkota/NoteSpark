// react-native for the desktop renderer: react-native-web, plus the bits of the native API it lacks that the phone's
// screens call.
import React from 'react';
import { FlatList as WebFlatList, TextInput as WebTextInput } from 'react-native-web';

export * from 'react-native-web';

// Some libraries default-import react-native; the dev server (native ES modules) needs the default to exist.
import * as self from './react-native';
export default self;

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

// react-native-web's list keeps 21 screens of rows alive by default (about 1,250 DOM nodes on Home). A computer has a
// fast scroll wheel but plenty of CPU: 5 screens (two above, two below) keeps memory and layout work small.
export const FlatList = React.forwardRef<any, any>((props, ref) => (
  <WebFlatList windowSize={5} initialNumToRender={10} maxToRenderPerBatch={10} updateCellsBatchingPeriod={40} {...props} ref={ref} />
));
