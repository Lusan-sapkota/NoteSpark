// Is anyone using the app? The desktop window counts while it has focus; web view requests count as they happen.
// Kept apart from storage.ts so the window can report in without loading the storage code.
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
