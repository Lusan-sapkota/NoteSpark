// The application menu: the menu bar on macOS, the global menu on Linux desktops that have one (KDE and others), and
// the keyboard shortcuts everywhere. Items that open a place in the app send an action to the window.
import { app, Menu, MenuItemConstructorOptions, nativeTheme, shell } from 'electron';

export type MenuAction =
  | { type: 'go'; routes: string[] } // where to go, as the stack of screens under it (Home first)
  | { type: 'theme'; mode: 'light' | 'dark' | 'system' };

const SOURCE_URL = 'https://github.com/Lusan-Sapkota/NoteSpark';
const isMac = process.platform === 'darwin';

const go = (...routes: string[]): MenuAction => ({ type: 'go', routes: ['Home', ...routes] });

export const buildAppMenu = ({ send, webOn, toggleWeb, zoom }: { send(action: MenuAction): void; webOn: boolean; toggleWeb(): void; zoom(step: 1 | -1 | 0): void }): Menu => {
  const place = (label: string, accelerator: string, action: MenuAction): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(action) });
  const theme = (label: string, mode: 'light' | 'dark' | 'system'): MenuItemConstructorOptions => ({
    label, type: 'radio', checked: nativeTheme.themeSource === mode, click: () => send({ type: 'theme', mode }),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: 'About NoteSpark', click: () => send(go('Settings', 'About')) },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => send(go('Settings')) },
        { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
        { role: 'quit' },
      ],
    } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        place('New note', 'CmdOrCtrl+N', go('Editor')),
        place('Import and export…', 'CmdOrCtrl+Shift+E', go('Settings', 'ImportExport')),
        { type: 'separator' },
        { label: webOn ? 'Stop web view' : 'Start web view', click: toggleWeb },
        { type: 'separator' },
        { role: 'close' },
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    // The standard roles are what make copy, paste and undo work in text fields (on macOS they do not work without them).
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'Go',
      submenu: [
        place('Notes', 'CmdOrCtrl+1', go()),
        place('Scratchpad', 'CmdOrCtrl+2', go('Scratchpad')),
        place('Tasks', 'CmdOrCtrl+3', go('Tasks')),
        place('Settings', isMac ? 'CmdOrCtrl+4' : 'CmdOrCtrl+4', go('Settings')),
        { type: 'separator' },
        place('Bin', 'CmdOrCtrl+Shift+Backspace', go('Settings', 'Bin')),
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Appearance', submenu: [theme('Match system', 'system'), theme('Light', 'light'), theme('Dark', 'dark')] },
        { type: 'separator' },
        // Own items instead of the roles, so the size is remembered (and starts suited to the screen).
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => zoom(1) },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-1) },
        { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, ...(isMac ? [{ role: 'zoom' } as MenuItemConstructorOptions] : []), { role: 'close' }] },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [{ label: 'About NoteSpark', click: () => send(go('Settings', 'About')) } as MenuItemConstructorOptions]),
        { label: 'Privacy policy', click: () => send(go('Settings', 'Privacy')) },
        // Opens in the person's own browser, like links in notes; the app itself never loads it.
        { label: 'Source code', click: () => { void shell.openExternal(SOURCE_URL); } },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
};
