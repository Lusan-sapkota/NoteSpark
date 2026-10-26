// The two search model files. electron.vite.config.ts rewrites the phone's require('../../assets/models/x') into
// 'models:x'; this finds the file: in the repository while developing, in the app's resources once packaged.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

// While developing the models are in the repository; this code may sit in out/main or in out/main/chunks.
const modelsDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'models') : ['../../../Mobile/assets/models', '../../../../Mobile/assets/models'].map(p => join(__dirname, p)).find(existsSync) ?? join(__dirname, '../../../Mobile/assets/models');

export const Asset = {
  loadAsync: async (assets: string[]) => assets.map(a => ({ localUri: join(modelsDir(), a.replace(/^models:/, '')) })),
};
