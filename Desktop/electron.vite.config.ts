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
  ['storage/notes', 'storage/profiles', 'storage/database', 'storage/semanticSearch', 'storage/autoBackup', 'storage/attachments', 'utils/exportNotes', 'utils/taskReminders', 'utils/imageCache', 'utils/notifications', 'widget/widgets', 'components/KeyboardSafePortal', 'components/Menu', 'screens/PrivacyScreen'].map(m => [`${mobileSrc}/${m}`, app(`overrides/${m}.${/^(components|screens)/.test(m) ? 'tsx' : 'ts'}`)]),
);

// The phone's storage code runs in the main process; its Expo imports resolve to the shims in src/main/shims.
const shim = (name: string) => resolve(__dirname, 'src/main/shims', name);
// The Expo modules the storage code uses live in ../packages/node-shims (no Electron imports, so tests and Docker share them).
const nodeShim = (name: string) => resolve(__dirname, '../packages/node-shims/src', name);
const expoShims = [
  { find: '@notespark/node-shims', replacement: resolve(__dirname, '../packages/node-shims/src') },
  { find: 'expo-file-system/legacy', replacement: nodeShim('expo-file-system-legacy.ts') },
  { find: 'expo-file-system', replacement: nodeShim('expo-file-system.ts') },
  { find: 'expo-sqlite', replacement: nodeShim('expo-sqlite.ts') },
  { find: 'expo-asset', replacement: shim('expo-asset.ts') },
  { find: 'react-native', replacement: shim('react-native.ts') },
  { find: 'onnxruntime-react-native', replacement: 'onnxruntime-node' }, // same API, for Node
  { find: 'expo-crypto', replacement: nodeShim('expo-crypto.ts') },
  { find: 'expo-secure-store', replacement: nodeShim('expo-secure-store.ts') },
  { find: 'expo-local-authentication', replacement: shim('expo-local-authentication.ts') },
  { find: '@react-native-async-storage/async-storage', replacement: nodeShim('async-storage.ts') },
];

export default defineConfig({
  main: {
    plugins: [
      {
        // Replaces loadEmbedder() with a call to the helper process in src/main/embedder.ts.
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
    // @notespark/sync (Yjs) is used by the phone's storage code only, so only the main process needs it.
    resolve: { alias: [{ find: '@notespark/core', replacement: alias['@notespark/core'] }, { find: '@notespark/sync', replacement: resolve(__dirname, '../packages/sync/src/index.ts') }, ...expoShims] },
    // The search model's helper process is a second entry next to the main one.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), 'embed-worker': resolve(__dirname, 'src/main/embed-worker.ts') } } },
  },
  preload: { resolve: { alias } },
  renderer: {
    // Let the dev server read ../Mobile.
    server: { fs: { allow: [resolve(__dirname, '..')] } },
    // Smaller code to parse and keep in memory; no source maps shipped.
    build: { minify: true, sourcemap: false },
    plugins: [
      react(),
      {
        // Dev only: React refresh injects an inline script that the strict CSP would block; builds keep `script-src 'self'`.
        name: 'dev-csp',
        apply: 'serve',
        transformIndexHtml: html => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      },
      {
        // Removes the phone's 680 reading-column cap so screens use the full width.
        name: 'desktop-full-width',
        enforce: 'pre',
        transform: (code, id) => (/Mobile\/src\/screens\/\w+\.tsx$/.test(id) && code.includes('maxWidth: readingWidth') ? code.replaceAll('maxWidth: readingWidth', "maxWidth: '100%'") : null),
      },
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
        // Phone-only copy edits; each must find its text so source changes fail the build loudly.
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
            // The desktop header already carries the app's name and logo; this row names the place.
            replace(": 'NoteSpark'}", ": 'Notes'}");
            // The places sit in this row, before the profile button (on the phone the profile button comes first).
            const profile = code.indexOf('              <Appbar.Action\n                icon="account-circle-outline"');
            const profileEnd = profile < 0 ? -1 : code.indexOf('/>\n', profile) + 3;
            const settings = code.indexOf('<Appbar.Action icon="cog-outline"');
            const settingsEnd = settings < 0 ? -1 : code.indexOf('\n', settings) + 1;
            if (profile < 0 || profileEnd < 3 || settingsEnd < 1 || settings < profileEnd) throw new Error(`desktop-copy: Home header actions not found in ${id}`);
            code = code.slice(0, profile) + code.slice(profileEnd, settingsEnd) + code.slice(profile, profileEnd) + code.slice(settingsEnd);
            return code;
          }
          if (id.endsWith('Mobile/src/screens/EditorScreen.tsx')) {
            replace('Your phone may be low on storage.', 'Your computer may be low on storage.');
            return code;
          }
          if (id.endsWith('Mobile/src/screens/ProfileLockScreen.tsx')) {
            // No fingerprint on desktop (no cross-platform Electron API): drop it and make PIN last.
            const start = code.indexOf('<LockChoice\n              icon={fingerprintReady');
            const end = start < 0 ? -1 : code.indexOf('\n            />\n', start);
            if (end < 0) throw new Error(`desktop-copy: fingerprint choice not found in ${id}`);
            code = code.slice(0, code.lastIndexOf('\n', start) + 1) + code.slice(end + '\n            />\n'.length);
            replace('isLast={false}\n            />\n          </View>', 'isLast\n            />\n          </View>');
            replace('Anyone using this phone can open it', 'Anyone using this computer can open it');
            return code;
          }
          if (id.endsWith('Mobile/src/screens/SettingsScreen.tsx')) {
            // Reminders and shared text run via src/main/notify.ts; the tray row ends the group.
            replaceAll(RESTORED, RESTORED_DESKTOP);
            replace('Your notes never leave your phone', 'Your notes never leave this computer');
            replace('description={shareLabel(shareTarget)}', 'description={`Save clipboard text from the tray: ${shareLabel(shareTarget).toLowerCase()}`}');
            const row = code.indexOf('title="Task reminders"');
            const flag = row < 0 ? -1 : code.indexOf('isLast\n', row);
            const end = row < 0 ? -1 : code.indexOf('\n          />\n', row);
            if (flag < 0 || end < 0) throw new Error(`desktop-copy: Task reminders row not found in ${id}`);
            const after = end + '\n          />\n'.length;
            code = `import KeepInTrayRow from '${app('KeepInTrayRow.tsx')}';\n` + code.slice(0, flag) + 'isLast={false}' + code.slice(flag + 'isLast'.length, after) + '          <KeepInTrayRow />\n' + code.slice(after);
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
        // Wraps icon buttons in a tooltip that reuses their accessibility label.
        name: 'desktop-tooltips',
        enforce: 'pre', // after desktop-copy, which looks for the unwrapped buttons
        transform: (code, id) => {
          if (!id.includes('/Mobile/src/') || !/\.tsx$/.test(id) || !/<(Appbar\.|IconButton)/.test(code)) return null;
          let count = 0;
          const wrapped = code.replace(/<(?:Appbar\.(?:Action|BackAction)|IconButton)\b((?:(?!\/>)[\s\S])*?)accessibilityLabel=("[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})((?:(?!\/>)[\s\S])*?)\/>/g, (all, _a, label) => { count++; return `<Tip title=${label}>${all}</Tip>`; });
          return count ? `import Tip from '${resolve(__dirname, 'src/renderer/app/Tip.tsx')}';\n${wrapped}` : null;
        },
      },
      {
        // Caps dialogs (centred) and snackbars (left) at 560 wide instead of the full window.
        name: 'desktop-dialog-width',
        enforce: 'pre',
        transform: (code, id) => {
          if (!id.includes('/Mobile/src/') || !/\.tsx$/.test(id) || !/<(Dialog|Snackbar)[\s>]/.test(code)) return null;
          return code
            .replace(/<Dialog(\s)/g, "<Dialog style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}$1")
            .replace(/<Snackbar(\s)/g, '<Snackbar style={{ maxWidth: 560 }}$1');
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
