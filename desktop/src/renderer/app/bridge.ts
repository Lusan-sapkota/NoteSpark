// Reaches the backend via Electron's preload bridge, or fetch() against the web view server in a browser.
declare global {
  interface Window { notespark?: { invoke(channel: string, args?: unknown): Promise<unknown>; refreshTray(): Promise<void>; onLockChanged(callback: () => void): void; onSyncChanged(callback: () => void): void; onMenu(callback: (action: unknown) => void): void; windowControl(action: 'minimize' | 'maximize' | 'close' | 'state'): Promise<{ maximized: boolean } | void>; popupMenu(x: number, y: number): Promise<void>; onWindowState(callback: (state: { maximized: boolean }) => void): void } }
}

export const isDesktop = !!window.notespark;

// A call that finds the profile locked tells the shell, which shows the unlock screen.
const check = (error: unknown) => {
  if (/PROFILE_LOCKED|PROFILE_UNREADABLE/.test(String((error as Error)?.message))) window.dispatchEvent(new Event('notespark-lock'));
  return error;
};

export const invoke = async <T = unknown>(channel: string, args?: unknown): Promise<T> => {
  try {
    return await call<T>(channel, args);
  } catch (error) {
    throw check(error);
  }
};

const call = async <T,>(channel: string, args?: unknown): Promise<T> => {
  if (window.notespark) return (await window.notespark.invoke(channel, args)) as T;
  const res = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args }),
  });
  const body = await res.json().catch(() => ({ error: `${res.status}` }));
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body.result as T;
};

export type WebStatus = { on: boolean; port: number; links: string[] };

// The phone's storage modules run in the main process; these proxies call them by name.
export const storageProxy = <M extends Record<string, any>>(module: string, names: readonly (keyof M & string)[], onDone?: (name: string) => void) =>
  Object.fromEntries(
    names.map(name => [
      name,
      async (...args: unknown[]) => {
        try {
          return await invoke('storage', { module, fn: name, args });
        } finally {
          onDone?.(name);
        }
      },
    ]),
  ) as { [K in (typeof names)[number]]: M[K] };
