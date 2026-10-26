import { contextBridge, ipcRenderer } from 'electron';

// The only bridge into the renderer: one call into the backend. The main process decides which channels exist.
contextBridge.exposeInMainWorld('notespark', {
  invoke: (channel: string, args?: unknown): Promise<unknown> => ipcRenderer.invoke('backend', channel, args),
  // Menu actions (open a place, change the appearance) arrive here once the screens are ready.
  onMenu: (callback: (action: unknown) => void) => { ipcRenderer.on('menu:action', (_e, action) => callback(action)); void ipcRenderer.invoke('menu:ready'); },
  onLockChanged: (callback: () => void) => { ipcRenderer.on('lock:changed', () => callback()); },
  refreshTray: (): Promise<void> => ipcRenderer.invoke('tray:refresh'),
  // The header's own minimise, maximise and close buttons.
  windowControl: (action: 'minimize' | 'maximize' | 'close' | 'state'): Promise<{ maximized: boolean } | void> => ipcRenderer.invoke('window:control', action),
  // Pops the application menu up at a point under the header's menu button.
  popupMenu: (x: number, y: number): Promise<void> => ipcRenderer.invoke('menu:popup', x, y),
  onWindowState: (callback: (state: { maximized: boolean }) => void) => { ipcRenderer.on('window:state', (_e, state) => callback(state)); },
});
