import { join } from 'node:path';
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, session, Tray, ipcMain } from 'electron';

// Strictly offline: no updater, crash reporter, analytics or remote content.
// The renderer may load only the app's own files (and the Vite dev server in development).
const devUrl = process.env.ELECTRON_RENDERER_URL;
const isAppUrl = (url: string) => url.startsWith('file://') || url.startsWith('devtools://') || (!!devUrl && url.startsWith(devUrl)) || url.startsWith('data:');

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
  // Closing destroys the renderer; the main process stays in the tray.
  win.on('closed', () => { window = null; });
  win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
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
    const ses = session.defaultSession;
    ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    ses.webRequest.onBeforeRequest((details, done) => done({ cancel: !isAppUrl(details.url) && !details.url.startsWith('ws://localhost') }));

    ipcMain.handle('theme:get', () => nativeTheme.themeSource);
    ipcMain.handle('theme:set', (_e, mode: unknown) => {
      if (mode === 'light' || mode === 'dark' || mode === 'system') nativeTheme.themeSource = mode;
    });

    tray = new Tray(icon.resize({ width: 22, height: 22 }));
    tray.setToolTip('NoteSpark');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open NoteSpark', click: showWindow },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', showWindow);
    Menu.setApplicationMenu(null);
    createWindow();
  });
}

