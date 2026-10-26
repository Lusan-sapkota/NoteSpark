import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { transformWithOxc } from 'vite';
import pkg from './package.json';

// Shared pure code lives in ../packages/core (same alias as Mobile).
const alias = { '@notespark/core': resolve(__dirname, '../packages/core/src/index.ts') };
const app = (path: string) => resolve(__dirname, 'src/renderer/app', path);
const mobileSrc = resolve(__dirname, '../Mobile/src');
// Phone modules that can't run in a browser are swapped, by file, for the versions in src/renderer/app/overrides.
const overrides: Record<string, string> = Object.fromEntries(
  ['storage/notes', 'storage/profiles', 'storage/database', 'storage/semanticSearch', 'storage/autoBackup', 'utils/exportNotes', 'utils/taskReminders', 'utils/imageCache', 'utils/notifications', 'widget/widgets', 'components/KeyboardSafePortal', 'screens/PrivacyScreen'].map(m => [`${mobileSrc}/${m}`, app(`overrides/${m}.${/^(components|screens)/.test(m) ? 'tsx' : 'ts'}`)]),
);

// The phone's storage code runs in the main process; its Expo imports resolve to the shims in src/main/shims.
const shim = (name: string) => resolve(__dirname, 'src/main/shims', name);
const expoShims = [
  { find: 'expo-file-system/legacy', replacement: shim('expo-file-system-legacy.ts') },
  { find: 'expo-sqlite', replacement: shim('expo-sqlite.ts') },
  { find: 'expo-asset', replacement: shim('expo-asset.ts') },
  { find: 'react-native', replacement: shim('react-native.ts') },
  { find: 'onnxruntime-react-native', replacement: 'onnxruntime-node' }, // same API, for Node
  { find: 'expo-crypto', replacement: shim('expo-crypto.ts') },
  { find: 'expo-secure-store', replacement: shim('expo-secure-store.ts') },
  { find: 'expo-local-authentication', replacement: shim('expo-local-authentication.ts') },
  { find: '@react-native-async-storage/async-storage', replacement: shim('async-storage.ts') },
];

export default defineConfig({
  main: {
    plugins: [
      {
        // The phone loads the model and runs it inside loadEmbedder(). Here that function is replaced by one that asks the
        // helper process in src/main/embedder.ts; the rest of the search code (chunks, index, queries) is untouched.
        name: 'embedder-in-helper-process',
        enforce: 'pre',
        transform: (code, id) => {
          if (!id.endsWith('Mobile/src/storage/semanticSearch.ts')) return null;
          const start = code.indexOf('const loadEmbedder = async (): Promise<Embed> => {');
          const end = code.indexOf('\n};\n\nconst getEmbedder', start);
          if (start < 0 || end < 0) throw new Error(`embedder-in-helper-process: loadEmbedder not found in ${id}`);
          return `import { embedInWorker } from '${resolve(__dirname, 'src/main/embedder.ts')}';\n` + code.slice(0, start) + 'const loadEmbedder = async (): Promise<Embed> => embedInWorker;' + code.slice(end + 3);
        },
      },
    ],
    resolve: { alias: [{ find: '@notespark/core', replacement: alias['@notespark/core'] }, ...expoShims] },
    // The search model's helper process is a second entry next to the main one.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), 'embed-worker': resolve(__dirname, 'src/main/embed-worker.ts') } } },
  },
  preload: { resolve: { alias } },
  renderer: {
    plugins: [
      react(),
      {
        name: 'phone-module-overrides',
        enforce: 'pre',
        resolveId: (source, importer) => (importer && source.startsWith('.') ? overrides[resolve(dirname(importer), source).replace(/\.tsx?$/, '')] : undefined),
      },
      {
        // The phone's pictures: require('x.png') becomes an image source with a bundled address.
        name: 'require-images',
        enforce: 'pre',
        transform: (code, id) =>
          id.includes('/Mobile/src/') && /require\((['"])\.\.?\/[^'"]+\.png\1\)/.test(code)
            ? code.replace(/require\((['"])(\.\.?\/[^'"]+\.png)\1\)/g, (_m, _q, file) => `({ uri: new URL('${file}', import.meta.url).href })`)
            : null,
      },
      {
        // Small, loud edits to phone screens for things that make no sense on a computer. Each edit must find its text,
        // so a change to the phone's source breaks the build here instead of quietly showing the wrong thing.
        name: 'desktop-copy',
        enforce: 'pre',
        transform: (code, id) => {
          const replace = (from: string, to: string) => {
            if (!code.includes(from)) throw new Error(`desktop-copy: "${from.slice(0, 50)}" not found in ${id}`);
            code = code.replace(from, to);
          };
          const replaceAll = (from: string, to: string) => {
            if (!code.includes(from)) throw new Error(`desktop-copy: "${from.slice(0, 50)}" not found in ${id}`);
            code = code.replaceAll(from, to);
          };
          const RESTORED = "If this phone was restored from a backup, a locked profile's encryption key isn't included in backups.";
          const RESTORED_DESKTOP = "If NoteSpark's folder was moved or restored from a backup, a protected profile's key may be missing: it is kept in your system's keyring, not in the folder.";
          if (id.endsWith('Mobile/src/screens/HomeScreen.tsx')) {
            replaceAll(RESTORED, RESTORED_DESKTOP);
            // Scratchpad, Tasks and Settings live in the desktop top bar, so Home's header keeps only the profile button.
            for (const label of ['Scratchpad', 'Tasks', 'Settings']) {
              const start = code.indexOf(`<Appbar.Action icon="`, code.indexOf('accessibilityLabel="' + label + '" onPress=') - 80);
              const end = code.indexOf('\n', code.indexOf('accessibilityLabel="' + label + '" onPress='));
              if (!code.includes('accessibilityLabel="' + label + '" onPress=') || start < 0) throw new Error(`desktop-copy: Home header action "${label}" not found in ${id}`);
              code = code.slice(0, code.lastIndexOf('\n', start) + 1) + code.slice(end + 1);
            }
            return code;
          }
          if (id.endsWith('Mobile/src/screens/EditorScreen.tsx')) {
            replace('Your phone may be low on storage.', 'Your computer may be low on storage.');
            return code;
          }
          if (id.endsWith('Mobile/src/screens/ProfileLockScreen.tsx')) {
            // No fingerprint unlock on desktop (Electron has no cross-platform API for it), so the third choice goes
            // and PIN becomes the last of the group.
            const start = code.indexOf('<LockChoice\n              icon={fingerprintReady');
            const end = start < 0 ? -1 : code.indexOf('\n            />\n', start);
            if (end < 0) throw new Error(`desktop-copy: fingerprint choice not found in ${id}`);
            code = code.slice(0, code.lastIndexOf('\n', start) + 1) + code.slice(end + '\n            />\n'.length);
            replace('isLast={false}\n            />\n          </View>', 'isLast\n            />\n          </View>');
            replace('Anyone using this phone can open it', 'Anyone using this computer can open it');
            return code;
          }
          const dropRow = (title: string) => {
            const start = code.indexOf(`<GroupedRow\n            title="${title}"`);
            const end = start < 0 ? -1 : code.indexOf('\n          />\n', start);
            if (end < 0) throw new Error(`desktop-copy: row "${title}" not found in ${id}`);
            code = code.slice(0, code.lastIndexOf('\n', start) + 1) + code.slice(end + '\n          />\n'.length);
          };
          if (id.endsWith('Mobile/src/screens/SettingsScreen.tsx')) {
            // Share-to-NoteSpark and task reminders are phone features; the row above them becomes the last in its group.
            replaceAll(RESTORED, RESTORED_DESKTOP);
            replace('Your notes never leave your phone', 'Your notes never leave this computer');
            dropRow('Text shared to NoteSpark');
            dropRow('Task reminders');
            const row = code.indexOf('title="Rediscover on Home"');
            const flag = row < 0 ? -1 : code.indexOf('isLast={false}', row);
            if (flag < 0) throw new Error(`desktop-copy: Rediscover row not found in ${id}`);
            code = code.slice(0, flag) + 'isLast' + code.slice(flag + 'isLast={false}'.length);
            return code;
          }
          if (id.endsWith('Mobile/src/screens/OnboardingScreen.tsx')) {
            replace('Notes that stay on your phone', 'Notes that stay on this computer');
            replace('No account, no cloud, no ads. Even search works offline: it finds notes by meaning, not just by matching words.', 'No account, no cloud, no ads. Your notes live in a database on this computer. The web view, if you turn it on, is only for devices on your own network.');
            replace('Tap New note on the home screen and start typing.', 'Choose New note on the home screen and start typing.');
            return code;
          }
          return null;
        },
      },
      {
        // Two phone files load a module with require() inside a handler, which a browser bundle doesn't have.
        name: 'inline-requires',
        enforce: 'pre',
        transform: (code, id) => {
          const rewrite = (file: string, module: string, name: string) =>
            id.endsWith(file) && code.includes(`require('${module}')`) ? `import * as ${name} from '${module}';\n${code.replaceAll(`require('${module}')`, name)}` : null;
          return rewrite('Mobile/src/screens/ImportExportScreen.tsx', 'expo-print', '__expoPrint') ?? rewrite('Mobile/src/components/MarkdownRenderer.tsx', 'react-native', '__reactNative');
        },
      },
      {
        // @expo/vector-icons ships JSX inside .js files.
        name: 'jsx-in-js',
        enforce: 'pre',
        transform: (code, id) => (/node_modules\/(@expo\/vector-icons|react-native-markdown-display|react-native-fit-image)\/.*\.js$/.test(id) ? transformWithOxc(code, id, { lang: 'jsx' }) : null),
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
        'react-native': app('shims/react-native.tsx'),
        '@react-navigation/native': app('nav.tsx'),
        'react-native-reanimated': app('shims/reanimated.tsx'),
        'expo-application': app('shims/application.ts'),
        'expo-image-picker': app('shims/image-picker.ts'),
        'expo-file-system/legacy': app('shims/file-system.ts'),
        'expo-sharing': app('shims/sharing.ts'),
        'expo-document-picker': app('shims/document-picker.ts'),
        'expo-print': app('shims/print.ts'),
        'react-native-keyboard-controller': app('shims/keyboard-controller.tsx'),
        'expo-font': app('shims/expo-font.ts'),
        'react-native-safe-area-context': app('shims/safe-area.tsx'),
        '@react-native-async-storage/async-storage': app('shims/async-storage.ts'),
      },
      // Mobile/ has its own node_modules; make its files use Desktop's single copy.
      dedupe: ['react', 'react-dom', 'react-native-paper', '@expo/vector-icons', 'react-native-markdown-display'],
    },
    define: { __APP_VERSION__: JSON.stringify(pkg.version), global: 'globalThis', __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
  },
});
