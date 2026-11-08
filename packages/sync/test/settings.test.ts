import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogUpdate, readSettingEntries } from '../src/index.ts';

const values = (updates: Uint8Array[]) => Object.fromEntries(readSettingEntries(updates).map(e => [e.name, e.value]));

test('the newest value of a setting wins, an older one is ignored, odd names and huge values are skipped', () => {
  const a = catalogUpdate([], 1, { settings: [{ name: 'theme', value: 'dark', at: 100 }] })!;
  const b = catalogUpdate([a], 1, { settings: [{ name: 'theme', value: 'light', at: 50 }] });
  assert.equal(b, null, 'older than what is there: nothing written');
  const c = catalogUpdate([a], 1, { settings: [{ name: 'theme', value: 'light', at: 200 }, { name: 'bad name!', value: 'x', at: 1 }, { name: 'big', value: 'x'.repeat(400), at: 1 }] })!;
  assert.deepEqual(values([a, c]), { theme: 'light' });
});
