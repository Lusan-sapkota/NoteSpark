// Desktop motion is plain CSS, so list layout animation passes through unchanged.
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

// Minimal shared values and timing for the wavy progress bar, driven by a requestAnimationFrame loop.
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach(fn => fn());

type Animation = { __animation: true; to: number; duration: number; easing: (t: number) => number; repeat: number };
export type SharedValue<T> = { value: T };

class Shared {
  private current: number;
  private frame = 0;
  constructor(initial: number) { this.current = initial; }
  get value() { return this.current; }
  set value(next: number | Animation) {
    cancelAnimation(this);
    if (typeof next === 'number') { this.current = next; notify(); return; }
    const from = this.current;
    let runs = 0;
    let start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / next.duration);
      this.current = from + (next.to - from) * next.easing(t);
      notify();
      if (t < 1) { this.frame = requestAnimationFrame(tick); return; }
      if (next.repeat < 0 || ++runs < next.repeat) { start = now; this.frame = requestAnimationFrame(tick); }
    };
    this.frame = requestAnimationFrame(tick);
  }
  cancel() { cancelAnimationFrame(this.frame); }
}

export const useSharedValue = (initial: number) => React.useRef(new Shared(initial)).current as unknown as SharedValue<number>;
export const cancelAnimation = (shared: unknown) => (shared as Shared).cancel();
export const Easing = { linear: (t: number) => t };
export const withTiming = (to: number, options: { duration?: number; easing?: (t: number) => number } = {}): any =>
  ({ __animation: true, to, duration: options.duration ?? 300, easing: options.easing ?? ((t: number) => t), repeat: 1 });
export const withRepeat = (animation: any, times = 1, _reverse = false): any => ({ ...animation, repeat: times });
export const useAnimatedStyle = <T,>(factory: () => T): T => {
  const [, setTick] = React.useState(0);
  React.useEffect(() => { const fn = () => setTick(t => t + 1); subscribers.add(fn); return () => { subscribers.delete(fn); }; }, []);
  return factory();
};
// Springs settle in about a quarter second; a timed ease is close enough for the switch thumb.
export const withSpring = (to: number, _options?: unknown): any => withTiming(to, { duration: 250, easing: (t: number) => 1 - (1 - t) ** 3 });

// Entering animations are skipped on desktop; the object only has to answer the calls the screens make.
const entering: any = { springify: () => entering, duration: () => entering, delay: () => entering };
export const FadeInRight = entering;
export const FadeIn = entering;
