// A small stack navigator with the parts of @react-navigation/native that the phone's screens call.
// Only the top screen is mounted, so a screen reloads when you come back to it.
// ponytail: no back/forward animation and no state kept under the top screen; a wide-window shell comes in phase 4.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type Route = { key: string; name: string; params?: any };
type Listener = () => void;

let counter = 0;
const route = (name: string, params?: any): Route => ({ key: `${name}-${++counter}`, name, params });

type Nav = {
  navigate(name: string, params?: any): void;
  push(name: string, params?: any): void;
  popTo(name: string, params?: any): void;
  goBack(): void;
  replace(name: string, params?: any): void;
  reset(state: { routes: { name: string; params?: any }[] }): void;
  setParams(params: any): void;
  canGoBack(): boolean;
  isFocused(): boolean;
  addListener(event: string, cb: Listener): () => void;
};

const NavContext = createContext<{ nav: Nav; route: Route } | null>(null);

export const useNavigation = <T = Nav,>() => useContext(NavContext)!.nav as unknown as T;
export const useRoute = <T = Route,>() => useContext(NavContext)!.route as unknown as T;
export const useIsFocused = () => true;
// Runs when the screen appears (it is mounted only while on top) and cleans up when it leaves.
export const useFocusEffect = (effect: () => void | (() => void)) => {
  const ref = useRef(effect);
  ref.current = effect;
  useEffect(() => ref.current(), []);
};

export const Navigator: React.FC<{ initial: string; screens: Record<string, React.ComponentType<any>> }> = ({ initial, screens }) => {
  const [stack, setStack] = useState<Route[]>(() => [route(initial)]);
  const top = stack[stack.length - 1];
  const listeners = useRef(new Map<string, Set<Listener>>());

  const nav = useMemo<Nav>(() => ({
    navigate: (name, params) => setStack(s => (s[s.length - 1].name === name ? [...s.slice(0, -1), { ...s[s.length - 1], params }] : [...s, route(name, params)])),
    push: (name, params) => setStack(s => [...s, route(name, params)]),
    popTo: (name, params) => setStack(s => {
      const at = s.map(r => r.name).lastIndexOf(name);
      return at < 0 ? [...s, route(name, params)] : [...s.slice(0, at), { ...s[at], params }];
    }),
    goBack: () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (name, params) => setStack(s => [...s.slice(0, -1), route(name, params)]),
    reset: ({ routes }) => setStack(routes.map(r => route(r.name, r.params))),
    setParams: params => setStack(s => [...s.slice(0, -1), { ...s[s.length - 1], params: { ...s[s.length - 1].params, ...params } }]),
    canGoBack: () => stack.length > 1,
    isFocused: () => true,
    addListener: (event, cb) => {
      const set = listeners.current.get(event) ?? new Set();
      listeners.current.set(event, set.add(cb));
      if (event === 'focus') queueMicrotask(cb); // the screen is already showing
      return () => set.delete(cb);
    },
  }), [stack.length]);

  const Screen = screens[top.name];
  return <NavContext.Provider value={{ nav, route: top }}>{Screen ? <Screen key={top.key} /> : null}</NavContext.Provider>;
};

// Pieces of the real package that the phone's code imports but the five screens never use.
export const createNavigationContainerRef = () => ({});
export const NavigationContainer = ({ children }: any) => <>{children}</>;
export const DefaultTheme = { dark: false, colors: { primary: '', background: '', card: '', text: '', border: '', notification: '' }, fonts: {} as any };
export const DarkTheme = { ...DefaultTheme, dark: true };
