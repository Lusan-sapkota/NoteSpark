// The application menu and keyboard shortcuts; items that open a place send an action to the window.
import { t } from '@notespark/core';
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
        { label: t('desktop.about'), click: () => send(go('Settings', 'About')) },
        { type: 'separator' },
        { label: t('desktop.settingsMenu'), accelerator: 'Cmd+,', click: () => send(go('Settings')) },
        { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
        { role: 'quit' },
      ],
    } as MenuItemConstructorOptions] : []),
    {
      label: t('desktop.fileMenu'),
      submenu: [
        place(t('desktop.newNote'), 'CmdOrCtrl+N', go('Editor')),
        place(t('desktop.importExportMenu'), 'CmdOrCtrl+Shift+E', go('Settings', 'ImportExport')),
        { type: 'separator' },
        { label: webOn ? t('desktop.stopWebView') : t('desktop.startWebView'), click: toggleWeb },
        { type: 'separator' },
        { role: 'close' },
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    // The standard roles are what make copy, paste and undo work in text fields (on macOS they do not work without them).
    {
      label: t('desktop.editMenu'),
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: t('desktop.goMenu'),
      submenu: [
        place(t('common.notes'), 'CmdOrCtrl+1', go()),
        place(t('common.scratchpad'), 'CmdOrCtrl+2', go('Scratchpad')),
        place(t('common.tasks'), 'CmdOrCtrl+3', go('Tasks')),
        place(t('common.settings'), 'CmdOrCtrl+4', go('Settings')),
        place(t('desktop.askNotes'), 'CmdOrCtrl+5', go('Ask')),
        place(t('desktop.tidyNotes'), 'CmdOrCtrl+6', go('Tidy')),
        place(t('landscape.title'), 'CmdOrCtrl+7', go('Landscape')),
        place(t('review.title'), 'CmdOrCtrl+8', go('Review')),
        { type: 'separator' },
        place(t('desktop.bin'), 'CmdOrCtrl+Shift+Backspace', go('Settings', 'Bin')),
      ],
    },
    {
      label: t('desktop.viewMenu'),
      submenu: [
        { label: t('desktop.appearance'), submenu: [theme(t('desktop.matchSystem'), 'system'), theme(t('desktop.light'), 'light'), theme(t('desktop.dark'), 'dark')] },
        { type: 'separator' },
        // Own items instead of the roles, so the size is remembered (and starts suited to the screen).
        { label: t('desktop.zoomIn'), accelerator: 'CmdOrCtrl+=', click: () => zoom(1) },
        { label: t('desktop.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => zoom(-1) },
        { label: t('desktop.actualSize'), accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: t('desktop.windowMenu'), submenu: [{ role: 'minimize' }, ...(isMac ? [{ role: 'zoom' } as MenuItemConstructorOptions] : []), { role: 'close' }] },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [{ label: t('desktop.about'), click: () => send(go('Settings', 'About')) } as MenuItemConstructorOptions]),
        { label: t('desktop.privacyPolicy'), click: () => send(go('Settings', 'Privacy')) },
        // Opens in the person's own browser, like links in notes; the app itself never loads it.
        { label: t('desktop.sourceCode'), click: () => { void shell.openExternal(SOURCE_URL); } },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
};
