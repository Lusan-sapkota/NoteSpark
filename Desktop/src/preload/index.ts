import { contextBridge, ipcRenderer } from 'electron';

// The only bridge into the renderer: read and set the light / dark / system preference.
contextBridge.exposeInMainWorld('notespark', {
  getTheme: (): Promise<string> => ipcRenderer.invoke('theme:get'),
  setTheme: (mode: 'light' | 'dark' | 'system'): Promise<void> => ipcRenderer.invoke('theme:set', mode),
});
