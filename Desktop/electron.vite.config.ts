import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { transformWithOxc } from 'vite';

// Shared pure code lives in ../packages/core (same alias as Mobile).
const alias = { '@notespark/core': resolve(__dirname, '../packages/core/src/index.ts') };
const stub = (name: string) => resolve(__dirname, 'src/renderer/spike/stubs', name);

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    plugins: [
      react(),
      {
        // @expo/vector-icons ships JSX inside .js files.
        name: 'jsx-in-js',
        enforce: 'pre',
        transform: (code, id) => (/@expo\/vector-icons\/.*\.js$/.test(id) ? transformWithOxc(code, id, { lang: 'jsx' }) : null),
      },
      {
        // Mobile's theme.ts loads fonts with require('x.ttf'); turn that into a Vite asset URL.
        name: 'require-font',
        transform: (code, id) =>
          id.endsWith('Mobile/src/theme/theme.ts')
            ? code.replace(/require\((['"][^'"]+\.ttf['"])\)/g, 'new URL($1, import.meta.url).href')
            : null,
      },
    ],
    resolve: {
      alias: {
        ...alias,
        'react-native': resolve(__dirname, 'node_modules/react-native-web/dist/index.js'),
        '@react-navigation/native': stub('react-navigation.ts'),
        'expo-font': stub('expo-font.ts'),
        'react-native-safe-area-context': stub('safe-area.tsx'),
        '@react-native-async-storage/async-storage': stub('async-storage.ts'),
      },
      // Mobile/ has its own node_modules; make its files use Desktop's single copy.
      dedupe: ['react', 'react-dom', 'react-native-paper', '@expo/vector-icons'],
    },
    define: { global: 'globalThis', __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
  },
});
