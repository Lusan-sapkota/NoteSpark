import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { transformWithOxc } from 'vite';

// Shared pure code lives in ../packages/core (same alias as Mobile).
const alias = { '@notespark/core': resolve(__dirname, '../packages/core/src/index.ts') };
const stub = (name: string) => resolve(__dirname, 'src/renderer/spike/stubs', name);

// The phone's storage code runs in the main process; its Expo imports resolve to the shims in src/main/shims.
const shim = (name: string) => resolve(__dirname, 'src/main/shims', name);
const expoShims = [
  { find: 'expo-file-system/legacy', replacement: shim('expo-file-system-legacy.ts') },
  { find: 'expo-sqlite', replacement: shim('expo-sqlite.ts') },
  { find: 'expo-crypto', replacement: shim('expo-crypto.ts') },
  { find: 'expo-secure-store', replacement: shim('expo-secure-store.ts') },
  { find: 'expo-local-authentication', replacement: shim('expo-local-authentication.ts') },
  { find: '@react-native-async-storage/async-storage', replacement: shim('async-storage.ts') },
];

export default defineConfig({
  main: { resolve: { alias: [{ find: '@notespark/core', replacement: alias['@notespark/core'] }, ...expoShims] } },
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
