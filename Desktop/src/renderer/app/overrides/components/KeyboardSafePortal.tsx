// The phone lifts dialogs above the on-screen keyboard; a desktop has none, so this is a plain Portal.
import React from 'react';
import { Portal } from 'react-native-paper';

const KeyboardSafePortal: React.FC<{ children: React.ReactNode }> = ({ children }) => <Portal>{children}</Portal>;
export default KeyboardSafePortal;
