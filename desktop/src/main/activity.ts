// Tracks whether anyone is using the app (window focus, web view requests), apart from storage.ts to avoid loading it.
let focused = false;
let last = Date.now();
let onAway: (() => void) | undefined;

export const setWindowFocused = (value: boolean) => {
  focused = value;
  last = Date.now();
  if (!value) onAway?.();
};
export const touch = () => { last = Date.now(); };
export const idleMs = () => (focused ? 0 : Date.now() - last);

// Called when the window loses focus and every ten seconds after, until the lock has a reason to act.
export const watchAway = (callback: () => void) => {
  onAway = callback;
  setInterval(callback, 10_000).unref();
};
