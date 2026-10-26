// The five desktop screens use Reanimated only for list layout animation and the reduced-motion check.
// Motion on desktop is plain CSS for now, so these pass the list through unchanged.
import React from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';

const withoutAnimationProps = (Component: any) =>
  React.forwardRef<any, any>(({ itemLayoutAnimation, layout, entering, exiting, ...props }, ref) => <Component ref={ref} {...props} />);

const Animated = {
  View: withoutAnimationProps(View),
  Text: withoutAnimationProps(Text),
  ScrollView: withoutAnimationProps(ScrollView),
  FlatList: withoutAnimationProps(FlatList),
  createAnimatedComponent: withoutAnimationProps,
};
export default Animated;

const transition: any = { springify: () => transition, damping: () => transition, stiffness: () => transition, duration: () => transition };
export const LinearTransition = transition;

export const useReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
