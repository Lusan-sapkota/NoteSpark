import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Shared pure code lives in ../packages/core (same alias as Mobile).
const alias = { '@notespark/core': resolve(__dirname, '../packages/core/src/index.ts') };

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: { resolve: { alias } },
});
