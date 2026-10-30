import { clipboard, nativeTheme } from 'electron';
import { touch } from './activity';
import { renderPdf, saveImage } from './assets';
import { startWebView, stopWebView, webViewStatus } from './web';

// One API for both transports: Electron IPC (the window) and HTTP (the web view).
// `local` handlers run only for the desktop window, never from the browser.
type Handler = { local?: boolean; run: (args: any, from: 'ipc' | 'http') => unknown | Promise<unknown> };

const handlers: Record<string, Handler> = {
  // The storage and settings code loads on first use, so a tray-only app stays small.
  storage: { run: async (args, from) => (await import('./storage')).callStorage(args as any, from) },
  'search:available': { run: async () => (await import('./storage')).searchAvailable() },
  'lock:status': { run: async () => (await import('./storage')).lockStatus() },
  'lock:unlock': { local: true, run: async args => (await import('./storage')).unlock(args) },
  'lock:erase': { local: true, run: async () => (await import('./storage')).eraseLocked() },
  'lock:retry': { local: true, run: async () => (await import('./storage')).retryOpen() },
  settings: { run: async args => (await import('./storage')).callSettings(args as any) },
  'pdf:render': { run: args => renderPdf(args) },
  'images:save': { run: args => saveImage(args) },
  'theme:get': { local: true, run: () => nativeTheme.themeSource },
  'theme:set': {
    local: true,
    run: (mode: unknown) => { if (mode === 'light' || mode === 'dark' || mode === 'system') nativeTheme.themeSource = mode; },
  },
  // Pairing tokens pass through here, so sync is for the desktop window only, never the web view.
  sync: {
    local: true,
    run: async (args: any) => {
      const hub = (await import('./sync')).syncHub();
      // Copying goes through the main process so a pairing code or the diagnostics never pass through the page.
      if (args?.op === 'copy') { clipboard.writeText((await hub.call('copyText', args.args)) as string); return null; }
      const result = await hub.call(String(args?.op), args?.args);
      // The Wi-Fi switch changes what the web view listens on: a running view restarts so it follows.
      if (args?.op === 'update' && typeof args.args?.webLan === 'boolean' && webViewStatus().on) { await stopWebView(); await startWebView(invoke); }
      return result;
    },
  },
  'web:status': { local: true, run: () => webViewStatus() },
  'web:start': { local: true, run: () => startWebView(invoke) },
  // The link carries the token, so it goes to the clipboard from here and never passes through the page.
  'web:copy': { local: true, run: () => { clipboard.writeText(webViewStatus().links.at(-1) ?? ''); } },
  'web:stop': { local: true, run: () => stopWebView() },
};

export const invoke = async (channel: string, args: unknown, from: 'ipc' | 'http') => {
  const handler = Object.hasOwn(handlers, channel) ? handlers[channel] : undefined;
  if (!handler || (handler.local && from !== 'ipc')) throw new Error(`Unknown channel: ${channel}`);
  if (from === 'http') touch(); // using the web view counts as using the app
  return handler.run(args, from);
};
