import { join } from 'node:path';
import { app, nativeTheme } from 'electron';
import { startWebView, stopWebView, webViewStatus } from './web';

// One API for both transports: Electron IPC (the window) and HTTP (the web view).
// `local` handlers run only for the desktop window, never from the browser.
type Handler = { local?: boolean; run: (args: any) => unknown | Promise<unknown> };

const handlers: Record<string, Handler> = {
  'notes:list': {
    async run() {
      // The native SQLite module loads only when notes are first asked for.
      const { default: Database } = await import('better-sqlite3-multiple-ciphers');
      const db = new Database(process.env.NOTESPARK_DB ?? join(app.getPath('userData'), 'notes.db'), { readonly: true, fileMustExist: true });
      try {
        const rows = db.prepare('SELECT * FROM notes WHERE deletedAt IS NULL ORDER BY isPinned DESC, updatedAt DESC').all() as Record<string, unknown>[];
        return rows.map(r => ({ ...r, isMarkdown: !!r.isMarkdown, isPinned: !!r.isPinned, isArchived: !!r.isArchived }));
      } finally { db.close(); }
    },
  },
  'theme:get': { local: true, run: () => nativeTheme.themeSource },
  'theme:set': {
    local: true,
    run: (mode: unknown) => { if (mode === 'light' || mode === 'dark' || mode === 'system') nativeTheme.themeSource = mode; },
  },
  'web:status': { local: true, run: () => webViewStatus() },
  'web:start': { local: true, run: () => startWebView(invoke) },
  'web:stop': { local: true, run: () => stopWebView() },
};

export const invoke = async (channel: string, args: unknown, from: 'ipc' | 'http') => {
  const handler = Object.hasOwn(handlers, channel) ? handlers[channel] : undefined;
  if (!handler || (handler.local && from !== 'ipc')) throw new Error(`Unknown channel: ${channel}`);
  return handler.run(args);
};
