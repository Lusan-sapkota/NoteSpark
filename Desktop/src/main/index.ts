import { join } from 'node:path';
import { app, BrowserWindow, clipboard, Menu, nativeImage, nativeTheme, protocol, session, shell, Tray, ipcMain } from 'electron';
import { firefly } from '@notespark/core';
import { serveAsset } from './assets';
import { setWindowFocused } from './activity';
import { invoke } from './backend';
import { buildAppMenu, MenuAction } from './menu';
import AsyncStorage from './shims/async-storage';
import { startWebView, stopWebView, webViewStatus } from './web';

// Strictly offline: no updater, crash reporter, analytics or remote content.
// The renderer may load only the app's own files (and the Vite dev server in development).
const devUrl = process.env.ELECTRON_RENDERER_URL;
const APP = 'app://notespark/';
const isAppUrl = (url: string) => url.startsWith(APP) || url.startsWith(`blob:${APP}`) || url.startsWith('devtools://') || (!!devUrl && url.startsWith(devUrl)) || url.startsWith('data:');

// Memory (see docs/architecture/desktop.md, "Memory"): V8 tuned for size instead of speed of peak code (the renderer
// uses about 45 MB less, with the same scroll and typing speed), a small young generation, no separate network process,
// and the GPU work in the main process in software (one process fewer, and no 125 MB GPU process left in the tray).
app.commandLine.appendSwitch('js-flags', '--optimize-for-size --max-semi-space-size=1 --min-semi-space-size=1');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');

// The UI is served from app://notespark/, so pictures at /images/<name> have the same address in the window and the web view.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'));
let window: BrowserWindow | null = null;

// Menu actions go to the window once its screens are ready (the window may have to be opened first).
let windowReady = false;
const queued: MenuAction[] = [];
const deliver = (action: MenuAction) => {
  if (window && windowReady) window.webContents.send('menu:action', action);
  else { queued.push(action); showWindow(); }
};
let tray: Tray | null = null;
let refreshMenuFn: (() => void) | null = null;

// Closing the window ends the app unless something still needs it: the web view is serving, or the person chose
// "Keep running in the tray". A running Electron app with no window still costs about 200 MB, so idle means gone.
const keepsRunning = async () => webViewStatus().on || (await AsyncStorage.getItem('keepInTray')) === 'true';
const quitIfIdle = async () => {
  if (BrowserWindow.getAllWindows().length === 0 && !(await keepsRunning())) app.quit();
};

// The header is the window's title bar (the app draws it); Electron draws the minimise, maximise and close buttons on
// top of it. Their colors come from the theme tokens and follow light and dark.
const HEADER_HEIGHT = 56;
const chrome = () => {
  const colors = nativeTheme.shouldUseDarkColors ? firefly.dark : firefly.light;
  return { color: colors.background, symbolColor: colors.onSurface, height: HEADER_HEIGHT };
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 480,
    minHeight: 400,
    show: false,
    icon,
    title: 'NoteSpark',
    titleBarStyle: 'hidden',
    titleBarOverlay: chrome(),
    autoHideMenuBar: true, // the menu lives in the global menu; Alt still shows it where there is none
    backgroundColor: chrome().color, // the theme's background, so there is no white flash
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false, // Electron downloads Hunspell dictionaries from a Google CDN otherwise
    },
  });
  win.once('ready-to-show', () => win.show());
  const recolor = () => { if (!win.isDestroyed()) win.setTitleBarOverlay(chrome()); };
  nativeTheme.on('updated', recolor);
  win.on('closed', () => { nativeTheme.off('updated', recolor); });
  // The auto-lock counts time while the window is out of sight or out of focus.
  win.on('focus', () => setWindowFocused(true));
  for (const event of ['blur', 'hide', 'minimize', 'closed'] as const) win.on(event as 'blur', () => setWindowFocused(false));
  // Closing destroys the renderer; the main process stays in the tray.
  win.on('closed', () => { window = null; windowReady = false; void quitIfIdle(); });
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
    const refreshTray = async () => {
      refreshMenuFn?.();
      const web = webViewStatus();
      const keep = (await AsyncStorage.getItem('keepInTray')) === 'true';
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open NoteSpark', click: showWindow },
        { type: 'separator' },
        web.on
          ? { label: 'Stop web view', click: () => stopWebView().then(refreshTray).then(quitIfIdle) }
          : { label: 'Start web view', click: () => startWebView(invoke).then(refreshTray, () => {}) },
        // The link carries the one-time token, so it is copied, never shown in the menu.
        ...(web.on ? [{ label: 'Copy web view link', click: () => clipboard.writeText(webViewStatus().links.at(-1) ?? '') }] : []),
        { type: 'separator' },
        { label: 'Keep running in the tray after closing', type: 'checkbox', checked: keep, click: item => AsyncStorage.setItem('keepInTray', String(item.checked)).then(refreshTray) },
        { label: 'Quit', click: () => app.quit() },
      ]));
    };
    void refreshTray();
    tray.on('click', showWindow);
    app.on('before-quit', () => { void stopWebView(); });
    ipcMain.handle('menu:ready', e => {
      if (e.sender !== window?.webContents) return;
      windowReady = true;
      for (const action of queued.splice(0)) window.webContents.send('menu:action', action);
    });
    ipcMain.handle('tray:refresh', async () => { await refreshTray(); });
    const refreshMenu = () => Menu.setApplicationMenu(buildAppMenu({
      send: action => {
        if (action.type !== 'theme') return deliver(action);
        // The appearance changes (and is remembered) without opening a window; an open window follows.
        nativeTheme.themeSource = action.mode;
        void AsyncStorage.setItem('themePreference', action.mode);
        if (window && windowReady) window.webContents.send('menu:action', action);
      },
      webOn: webViewStatus().on,
      toggleWeb: () => (webViewStatus().on ? stopWebView().then(refreshTray).then(quitIfIdle) : startWebView(invoke).then(refreshTray, () => {})),
    }));
    refreshMenuFn = refreshMenu;
    refreshMenu();
    nativeTheme.on('updated', refreshMenu);
    createWindow();
  });
}

