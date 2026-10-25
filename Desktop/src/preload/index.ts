import { contextBridge, ipcRenderer } from 'electron';

// The only bridge into the renderer: the notes list (read-only, spike) and the light / dark / system preference.
contextBridge.exposeInMainWorld('notespark', {
  listNotes: (): Promise<unknown[]> => ipcRenderer.invoke('notes:list'),
  getTheme: (): Promise<string> => ipcRenderer.invoke('theme:get'),
  setTheme: (mode: 'light' | 'dark' | 'system'): Promise<void> => ipcRenderer.invoke('theme:set', mode),
});
