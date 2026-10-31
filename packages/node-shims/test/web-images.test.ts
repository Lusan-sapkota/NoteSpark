// "Show web images" (Settings): off by default, and while off the phone's image loader contacts no website at all.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import './helpers.ts';

const { getCachedImage } = await import('../../../mobile/src/utils/imageCache.ts');
const { isWebImagesOn, setWebImagesOn } = await import('../../../mobile/src/utils/webImages.ts');

test('web images are off until switched on, and a note\'s image address is not requested while off', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from([137, 80, 78, 71])); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/a.png`;
  try {
    assert.equal(await isWebImagesOn(), false);
    assert.deepEqual(await getCachedImage(url), { status: 'off' });
    assert.equal(hits, 0);
    await setWebImagesOn(true);
    assert.notEqual((await getCachedImage(url)).status, 'off', 'on, the loader goes on to fetch (the shim has no downloadAsync, so it ends failed here)');
    await setWebImagesOn(false);
    assert.deepEqual(await getCachedImage(url), { status: 'off' }, 'a copy kept earlier is not shown while off');
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});
