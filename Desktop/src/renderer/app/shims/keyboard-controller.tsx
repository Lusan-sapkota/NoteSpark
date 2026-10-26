// A desktop has no on-screen keyboard to avoid.
import React from 'react';
import { ScrollView } from 'react-native';

export const KeyboardAwareScrollView = React.forwardRef<any, any>(({ bottomOffset, ...props }, ref) => <ScrollView ref={ref} {...props} />);
export const KeyboardProvider = ({ children }: any) => <>{children}</>;
