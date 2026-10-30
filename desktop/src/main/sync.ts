// Electron glue for sync: the hub's utility process, the folder dialog, window events. The logic is in syncHub.ts.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, dialog, utilityProcess } from 'electron';
import { SyncHub } from './syncHub';
import { isReady } from './storage';

let hub: SyncHub | null = null;

// Next to this code, or one folder up when the bundler put it in chunks/ (also inside app.asar once packaged).
const workerFile = () => [join(__dirname, 'hub-worker.js'), join(__dirname, '..', 'hub-worker.js')].find(existsSync) ?? join(__dirname, 'hub-worker.js');

export const syncHub = () =>
  (hub ??= new SyncHub({
    isReady,
    announce: () => BrowserWindow.getAllWindows().forEach(w => w.webContents.send('sync:changed')),
    chooseFolder: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    spawn: () => {
      const w = utilityProcess.fork(workerFile(), [], { serviceName: 'NoteSpark sync' });
      return {
        // The parent end of a utility process delivers the message itself (the child end wraps it in { data }).
        port: { send: m => void w.postMessage(m), on: cb => void w.on('message', cb as (m: unknown) => void) },
        kill: () => void w.kill(),
        onExit: cb => void w.on('exit', cb),
      };
    },
  }));

export const stopSync = () => (hub ? hub.stop() : Promise.resolve());
