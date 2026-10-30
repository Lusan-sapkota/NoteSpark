// react-native-web plus the native API bits the phone's screens call that it lacks.
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

// A window of 5 screens instead of the default 21 keeps DOM nodes and memory low.
export const FlatList = React.forwardRef<any, any>((props, ref) => (
  <WebFlatList windowSize={5} initialNumToRender={10} maxToRenderPerBatch={10} updateCellsBatchingPeriod={40} {...props} ref={ref} />
));

// Direction on the desktop is the page's (set by the language provider), so the phone's switch is never used.
export const I18nManager = { isRTL: false, allowRTL: (_allow: boolean) => {}, forceRTL: (_force: boolean) => {} };
