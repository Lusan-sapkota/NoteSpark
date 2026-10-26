import { join } from 'node:path';
import { app, BrowserWindow, clipboard, Menu, nativeImage, nativeTheme, protocol, session, shell, Tray, ipcMain } from 'electron';
import { serveAsset } from './assets';
import { setWindowFocused } from './activity';
import { invoke } from './backend';
import { startWebView, stopWebView, webViewStatus } from './web';

// Strictly offline: no updater, crash reporter, analytics or remote content.
// The renderer may load only the app's own files (and the Vite dev server in development).
const devUrl = process.env.ELECTRON_RENDERER_URL;
const APP = 'app://notespark/';
const isAppUrl = (url: string) => url.startsWith(APP) || url.startsWith(`blob:${APP}`) || url.startsWith('devtools://') || (!!devUrl && url.startsWith(devUrl)) || url.startsWith('data:');

// The UI is served from app://notespark/, so pictures at /images/<name> have the same address in the window and the web view.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'));
let window: BrowserWindow | null = null;
let tray: Tray | null = null;

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 480,
    minHeight: 400,
    show: false,
    icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12140d' : '#fbfaee', // Firefly background, no white flash
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false, // Electron downloads Hunspell dictionaries from a Google CDN otherwise
    },
  });
  win.once('ready-to-show', () => win.show());
  // The auto-lock counts time while the window is out of sight or out of focus.
  win.on('focus', () => setWindowFocused(true));
  for (const event of ['blur', 'hide', 'minimize', 'closed'] as const) win.on(event as 'blur', () => setWindowFocused(false));
  // Closing destroys the renderer; the main process stays in the tray.
  win.on('closed', () => { window = null; });
  win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  // A link the person clicks opens in their own browser (the same as the phone); the app itself never loads it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (devUrl) win.loadURL(devUrl);
  else win.loadURL(APP);
  window = win;
};

const showWindow = () => {
  if (!window) createWindow();
  else { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
};

// Software rendering in the main process: no separate GPU process, which would stay alive in the tray
// (about 125 MB less RAM there). ponytail: revisit if the web UI scrolls badly on low-end CPUs.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {}); // stay in the tray
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', e => e.preventDefault());
  });

  app.whenReady().then(() => {
    protocol.handle('app', async request => {
      const url = new URL(request.url);
      const asset = url.host === 'notespark' ? await serveAsset(url.pathname) : null;
      return asset
        ? new Response(new Uint8Array(asset.body), { headers: { 'Content-Type': asset.type, ...asset.headers } })
        : new Response('Not found', { status: 404 });
    });
    const ses = session.defaultSession;
    ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    ses.webRequest.onBeforeRequest((details, done) => done({ cancel: !isAppUrl(details.url) && !details.url.startsWith('ws://localhost') }));

    ipcMain.handle('backend', (e, channel: unknown, args: unknown) => {
      if (!e.senderFrame || !isAppUrl(e.senderFrame.url) || typeof channel !== 'string') throw new Error('Blocked');
      return invoke(channel, args, 'ipc');
    });

    tray = new Tray(icon.resize({ width: 22, height: 22 }));
    tray.setToolTip('NoteSpark');
    const refreshTray = () => {
      const web = webViewStatus();
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open NoteSpark', click: showWindow },
        { type: 'separator' },
        web.on
          ? { label: 'Stop web view', click: () => stopWebView().then(refreshTray) }
          : { label: 'Start web view', click: () => startWebView(invoke).then(refreshTray, () => {}) },
        // The link carries the one-time token, so it is copied, never shown in the menu.
        ...(web.on ? [{ label: 'Copy web view link', click: () => clipboard.writeText(webViewStatus().links.at(-1) ?? '') }] : []),
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]));
    };
    refreshTray();
    tray.on('click', showWindow);
    app.on('before-quit', () => { void stopWebView(); });
    ipcMain.handle('tray:refresh', refreshTray);
    Menu.setApplicationMenu(null);
    createWindow();
  });
}

