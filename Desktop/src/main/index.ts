import { join } from 'node:path';
import { app, BrowserWindow, clipboard, Menu, nativeImage, nativeTheme, protocol, screen, session, shell, Tray, ipcMain } from 'electron';
import { firefly } from '@notespark/core';
import { serveAsset } from './assets';
import { setWindowFocused } from './activity';
import { invoke } from './backend';
import { saveClipboard, startReminders } from './notify';
import { buildAppMenu, MenuAction } from './menu';
import AsyncStorage from '@notespark/node-shims/async-storage';
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

// Closing the window leaves the app in the tray (sync and the web view need it running) until the person chooses Quit
// there; unticking "Keep running in the tray" makes closing quit instead. About 175 MB while it sits in the tray.
const keepInTray = async () => (await AsyncStorage.getItem('trayOnClose')) !== 'false';
const keepsRunning = async () => webViewStatus().on || (await keepInTray());
const quitIfIdle = async () => {
  if (BrowserWindow.getAllWindows().length === 0 && !(await keepsRunning())) app.quit();
};

// The header is the window's title bar and draws its own minimise, maximise and close buttons (the system's are too
// small to hit comfortably and their size can't be changed), so the window has no frame: see the 'window:control' channel.
const pageColor = () => (nativeTheme.shouldUseDarkColors ? firefly.dark : firefly.light).background;

// The app's size. 100 % reads small on a large monitor, so it starts bigger there (by the width in points of the screen the
// window is on: 1536 on a 1920 panel and 2048 on a 2560 one, both at 125 % scaling, get 125 %);
// the person's own zoom (Ctrl+= and Ctrl+-) is remembered, and "Actual size" goes back to the automatic one.
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const autoZoom = () => {
  const width = (window && !window.isDestroyed() ? screen.getDisplayMatching(window.getBounds()) : screen.getPrimaryDisplay()).size.width;
  return width >= 2200 ? 1.5 : width >= 1400 ? 1.25 : 1;
};
const currentZoom = async () => Number(await AsyncStorage.getItem('zoomFactor')) || autoZoom();
const applyZoom = async () => { if (window && !window.isDestroyed()) window.webContents.setZoomFactor(await currentZoom()); };
const changeZoom = async (step: 1 | -1 | 0) => {
  const now = await currentZoom();
  if (step === 0) await AsyncStorage.removeItem('zoomFactor');
  else await AsyncStorage.setItem('zoomFactor', String(step > 0 ? ZOOM_STEPS.find(z => z > now + 0.001) ?? now : [...ZOOM_STEPS].reverse().find(z => z < now - 0.001) ?? now));
  await applyZoom();
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
    autoHideMenuBar: true, // the menu lives in the global menu; Alt still shows it where there is none
    backgroundColor: pageColor(), // the theme's background, so there is no white flash
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false, // Electron downloads Hunspell dictionaries from a Google CDN otherwise
    },
  });
  win.webContents.on('did-finish-load', () => void applyZoom());
  // Moving the window to another monitor can change the automatic size.
  let moved: NodeJS.Timeout | undefined;
  win.on('move', () => { clearTimeout(moved); moved = setTimeout(() => void applyZoom(), 300); });
  win.on('closed', () => clearTimeout(moved));
  win.once('ready-to-show', () => win.show());
  // The header's own window buttons show Maximize or Restore by this.
  const tellState = () => { if (!win.isDestroyed()) win.webContents.send('window:state', { maximized: win.isMaximized() || win.isFullScreen() }); };
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) win.on(event as 'maximize', tellState);
  // The auto-lock counts time while the window is out of sight or out of focus.
  win.on('focus', () => setWindowFocused(true));
  for (const event of ['blur', 'hide', 'minimize', 'closed'] as const) win.on(event as 'blur', () => setWindowFocused(false));
  // Closing destroys the renderer; quitIfIdle decides whether the app goes with it.
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

// Software rendering in the main process: no separate GPU process (about 125 MB less RAM).
// ponytail: revisit if the web UI scrolls badly on low-end CPUs.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {}); // quitIfIdle (on each window's close) decides; the default quit would ignore the tray and the web view
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
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open NoteSpark', click: showWindow },
        { type: 'separator' },
        web.on
          ? { label: 'Stop web view', click: () => stopWebView().then(refreshTray).then(quitIfIdle) }
          : { label: 'Start web view', click: () => startWebView(invoke).then(refreshTray, () => {}) },
        // The link carries the one-time token, so it is copied, never shown in the menu.
        ...(web.on ? [{ label: 'Copy web view link', click: () => clipboard.writeText(webViewStatus().links.at(-1) ?? '') }] : []),
        { type: 'separator' },
        { label: 'Save clipboard text', click: () => void saveClipboard((fn, ...args) => invoke('storage', { module: 'notes', fn, args }, 'ipc')) },
        { type: 'separator' },
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
    ipcMain.handle('window:control', (e, action: unknown) => {
      if (!window || e.sender !== window.webContents) return;
      if (action === 'minimize') window.minimize();
      else if (action === 'maximize') (window.isMaximized() ? window.unmaximize() : window.maximize());
      else if (action === 'close') window.close();
      else if (action === 'state') return { maximized: window.isMaximized() || window.isFullScreen() };
    });
    const refreshMenu = () => Menu.setApplicationMenu(buildAppMenu({
      send: action => {
        if (action.type !== 'theme') return deliver(action);
        // The appearance changes (and is remembered) without opening a window; an open window follows.
        nativeTheme.themeSource = action.mode;
        void AsyncStorage.setItem('themePreference', action.mode);
        if (window && windowReady) window.webContents.send('menu:action', action);
      },
      webOn: webViewStatus().on,
      zoom: step => void changeZoom(step),
      toggleWeb: () => (webViewStatus().on ? stopWebView().then(refreshTray).then(quitIfIdle) : startWebView(invoke).then(refreshTray, () => {})),
    }));
    refreshMenuFn = refreshMenu;
    refreshMenu();
    nativeTheme.on('updated', refreshMenu);
    createWindow();
    startReminders(() => deliver({ type: 'go', routes: ['Home', 'Tasks'] }));
  });
}

