// Runs the build's `desktop-copy` layout edits over every phone screen and fails if one can't find its anchor, so a change to a
// screen is caught here and not in the middle of `electron-vite build`. Usage: npm run check:copy
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { loadConfigFromFile } = await import(pathToFileURL(resolve('node_modules/vite/dist/node/index.js')).href);
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';
const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve('electron.vite.config.ts'));
const copy = (config.renderer?.plugins ?? []).flat(Infinity).find(p => p?.name === 'desktop-copy');
if (!copy) { console.error('desktop-copy plugin not found'); process.exit(1); }

const dir = resolve('../mobile/src/screens');
let failed = 0;
for (const name of readdirSync(dir).filter(f => f.endsWith('.tsx'))) {
  const id = resolve(dir, name);
  try { copy.transform(readFileSync(id, 'utf8'), id); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}
console.log(failed ? `${failed} screen(s) failed` : 'desktop-copy: every anchor found');
process.exit(failed ? 1 : 0);
