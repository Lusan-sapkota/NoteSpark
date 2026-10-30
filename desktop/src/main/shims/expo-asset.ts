// Resolves the search model files ('models:x') from the repository in dev, from app resources when packaged.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

// While developing the models are in the repository; this code may sit in out/main or in out/main/chunks.
const modelsDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'models') : ['../../../mobile/assets/models', '../../../../mobile/assets/models'].map(p => join(__dirname, p)).find(existsSync) ?? join(__dirname, '../../../mobile/assets/models');

export const Asset = {
  loadAsync: async (assets: string[]) => assets.map(a => ({ localUri: join(modelsDir(), a.replace(/^models:/, '')) })),
};
