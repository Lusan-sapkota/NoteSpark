import { join } from 'node:path';
import { app, BrowserWindow, clipboard, Menu, nativeImage, nativeTheme, protocol, screen, session, shell, Tray, ipcMain } from 'electron';
import { firefly, t } from '@notespark/core';
import { serveAsset } from './assets';
import { setWindowFocused } from './activity';
import { invoke } from './backend';
import { saveClipboard, startReminders } from './notify';
import { buildAppMenu, MenuAction } from './menu';
import AsyncStorage from '@notespark/node-shims/async-storage';
import { syncLanguage } from './language';
import { startWebView, stopWebView, webViewStatus } from './web';
import { stopSync, syncHub } from './sync';
import { onProfilesChanged } from './storage';

// The app stays offline and the renderer loads only local content or the development server.
const devUrl = process.env.ELECTRON_RENDERER_URL;
const APP = 'app://notespark/';
const isAppUrl = (url: string) => url.startsWith(APP) || url.startsWith(`blob:${APP}`) || url.startsWith('devtools://') || (!!devUrl && url.startsWith(devUrl)) || url.startsWith('data:');

app.commandLine.appendSwitch('js-flags', '--optimize-for-size --max-semi-space-size=1 --min-semi-space-size=1');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'));
let window: BrowserWindow | null = null;

// Queue menu actions until the window is ready.
let windowReady = false;
const queued: MenuAction[] = [];
const deliver = (action: MenuAction) => {
  if (window && windowReady) window.webContents.send('menu:action', action);
  else { queued.push(action); showWindow(); }
};
let tray: Tray | null = null;
let refreshMenuFn: (() => void) | null = null;

// Keep the app in the tray while sync or the web view is active unless disabled.
const keepInTray = async () => (await AsyncStorage.getItem('trayOnClose')) !== 'false';
const keepsRunning = async () => webViewStatus().on || (await keepInTray());
const quitIfIdle = async () => {
  if (BrowserWindow.getAllWindows().length === 0 && !(await keepsRunning())) app.quit();
};

const pageColor = () => (nativeTheme.shouldUseDarkColors ? firefly.dark : firefly.light).background;

// Choose an automatic zoom by screen size and remember manual changes.
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
    autoHideMenuBar: true,
    backgroundColor: pageColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.webContents.on('did-finish-load', () => void applyZoom());
  // Reapply automatic zoom when the window changes monitors.
  let moved: NodeJS.Timeout | undefined;
  win.on('move', () => { clearTimeout(moved); moved = setTimeout(() => void applyZoom(), 300); });
  win.on('closed', () => clearTimeout(moved));
  win.once('ready-to-show', () => win.show());
  const tellState = () => { if (!win.isDestroyed()) win.webContents.send('window:state', { maximized: win.isMaximized() || win.isFullScreen() }); };
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) win.on(event as 'maximize', tellState);
  // Track focus for the auto-lock timer.
  win.on('focus', () => setWindowFocused(true));
  for (const event of ['blur', 'hide', 'minimize', 'closed'] as const) win.on(event as 'blur', () => setWindowFocused(false));
  win.on('closed', () => { window = null; windowReady = false; void quitIfIdle(); });
  win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  // Open external links in the system browser.
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

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {});
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', e => e.preventDefault());
  });

  app.whenReady().then(async () => {
    await syncLanguage(); // before the menu and tray are built
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
      await syncLanguage();
      refreshMenuFn?.();
      const web = webViewStatus();
      tray?.setContextMenu(Menu.buildFromTemplate([
        { label: t('desktop.openNoteSpark'), click: showWindow },
        { label: t('desktop.newNote'), click: () => deliver({ type: 'go', routes: ['Home', 'Editor'] }) },
        { label: t('desktop.saveClipboard'), click: () => void saveClipboard((fn, ...args) => invoke('storage', { module: 'notes', fn, args }, 'ipc')) },
        { type: 'separator' },
        web.on
          ? {
              label: t('desktop.webViewOnMenu'),
              submenu: [
                { label: t('desktop.copyLink'), click: () => clipboard.writeText(webViewStatus().links.at(-1) ?? '') },
                { label: t('desktop.stop'), click: () => stopWebView().then(refreshTray).then(quitIfIdle) },
              ],
            }
          : { label: t('desktop.startWebView'), click: () => startWebView(invoke).then(refreshTray, () => {}) },
        { type: 'separator' },
        { label: t('desktop.quit'), click: () => app.quit() },
      ]));
    };
    void refreshTray();
    tray.on('click', showWindow);
    app.on('before-quit', () => { void stopWebView(); void stopSync(); });
    // Sync starts with the app when it was left on; the storage code opens first, the hub only follows it.
    onProfilesChanged(() => void syncHub().profilesChanged().catch(() => {}));
    void invoke('lock:status', undefined, 'ipc').then(() => syncHub().start()).catch(() => {});
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
    ipcMain.handle('menu:popup', (e, x: unknown, y: unknown) => {
      if (!window || e.sender !== window.webContents || typeof x !== 'number' || typeof y !== 'number') return;
      Menu.getApplicationMenu()?.popup({ window, x: Math.round(x), y: Math.round(y) });
    });
    const refreshMenu = () => Menu.setApplicationMenu(buildAppMenu({
      send: action => {
        if (action.type !== 'theme') return deliver(action);
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
