import { contextBridge, ipcRenderer } from 'electron';

// The only bridge into the renderer: one call into the backend. The main process decides which channels exist.
contextBridge.exposeInMainWorld('notespark', {
  invoke: (channel: string, args?: unknown): Promise<unknown> => ipcRenderer.invoke('backend', channel, args),
  refreshTray: (): Promise<void> => ipcRenderer.invoke('tray:refresh'),
});
