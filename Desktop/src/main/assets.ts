import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { BrowserWindow, session } from 'electron';
import { dataDir } from '@notespark/node-shims/paths';

// What the desktop window (app://notespark/) and the web view (http) both serve: the UI bundle and note pictures.
const root = join(__dirname, '../renderer');
const imagesDir = () => join(dataDir(), 'images');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
};
const IMAGE_NAME = /^[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$/;

export const serveAsset = async (pathname: string): Promise<{ type: string; body: Buffer; headers?: Record<string, string> } | null> => {
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  try {
    const image = /^\/images\/([^/]+)$/.exec(path);
    if (image) {
      if (!IMAGE_NAME.test(image[1])) return null;
      // Pictures are data, never pages: no script can run from them.
      return { type: types[extname(image[1])], body: await readFile(join(imagesDir(), image[1])), headers: { 'Content-Security-Policy': "default-src 'none'; sandbox" } };
    }
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + '/')) return null;
    return { type: types[extname(file)] ?? 'application/octet-stream', body: await readFile(file) };
  } catch {
    return null;
  }
};

const MAX_IMAGE = 15_000_000;
// Checks the first bytes, not the name the page sent.
const sniff = (b: Buffer) =>
  b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? '.png'
  : b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? '.jpg'
  : b.subarray(0, 4).toString('latin1') === 'GIF8' ? '.gif'
  : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? '.webp'
  : null;

// A picture added in the editor. Returns the address the note stores; it works in the window and the web view.
export const saveImage = ({ data }: { data: unknown }) => {
  if (typeof data !== 'string') throw new Error('Bad image');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE) throw new Error('Pictures can be up to 15 MB');
  const ext = sniff(bytes);
  if (!ext) throw new Error('Only PNG, JPEG, GIF and WebP pictures can be added');
  mkdirSync(imagesDir(), { recursive: true });
  const name = `${randomUUID()}${ext}`;
  writeFileSync(join(imagesDir(), name), bytes, { mode: 0o600, flag: 'wx' });
  return `/images/${name}`;
};

// Prints an HTML page to PDF in a hidden window with no scripts and no network (the import and export history).
export const renderPdf = async ({ html }: { html: unknown }) => {
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Bad page');
  const ses = session.fromPartition('pdf');
  ses.webRequest.onBeforeRequest((d, done) => done({ cancel: !d.url.startsWith('data:') }));
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, javascript: false, sandbox: true, contextIsolation: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return (await win.webContents.printToPDF({ printBackground: true })).toString('base64');
  } finally {
    win.destroy();
  }
};
