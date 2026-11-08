// Tidy hides, the profile name and the import history follow a synced profile; settings follow when switched on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { crdt, database, freshProfile, notes, profiles } from './helpers.ts';

const u = new URL('../../../mobile/src/utils/', import.meta.url).href;
const { syncRecords } = await import(`${u}syncedRecords.ts`);
const { syncSettings, setSyncSettingsOn } = await import(`${u}syncedSettings.ts`);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const names = async () => (await notes.getSettingsData()).settings.map((e: any) => e.name).sort();

test('hides, name and history go out, and what another device sent comes in', async () => {
  await freshProfile(true);
  const active = (await profiles.getActiveProfile()).id;
  await AsyncStorage.setItem(`tidyHidden:${active}`, JSON.stringify([`${A}-${B}`, '3-4']));
  await AsyncStorage.setItem('notesHistory', JSON.stringify([{ type: 'export', date: '2026-11-08T10:00:00.000Z', count: 2, error: '' }]));
  await syncRecords();
  const out = await names();
  assert.ok(out.includes(`hide:${A}-${B}`), 'the uuid hide went out');
  assert.ok(!out.some(n => n.includes('3-4')), 'an old number-based hide stays on this device');
  assert.ok(out.includes('profileName') && out.some(n => n.startsWith('import:')));

  // Another device: a hide, a newer name, an import, and a clear that covers the local export.
  await crdt.recordSettings(database.db, [
    { name: `hide:${B}-${A}`, value: '1', at: 5 },
    { name: 'profileName', value: 'Work', at: Date.now() + 1000 },
    { name: 'import:2026-11-09T09-00-00-000Z', value: JSON.stringify({ type: 'import', date: '2026-11-09T09:00:00.000Z', count: 1, error: '' }), at: 6 },
    { name: 'importCleared', value: String(Date.parse('2026-11-08T12:00:00.000Z')), at: 7 },
  ]);
  await syncRecords();
  assert.ok(JSON.parse((await AsyncStorage.getItem(`tidyHidden:${active}`))!).includes(`${B}-${A}`), 'their hide arrived');
  assert.equal((await profiles.getActiveProfile()).name, 'Work', 'the newer name was taken');
  const history = JSON.parse((await AsyncStorage.getItem('notesHistory'))!);
  assert.deepEqual(history.map((e: any) => e.type), ['import'], 'the clear dropped the older export, their import stays');
});

test('settings sync only when switched on; the first pass takes what others chose', async () => {
  await freshProfile(true);
  await AsyncStorage.setItem('themePreference', 'light');
  assert.equal(await syncSettings(), false);
  assert.ok(!(await names()).includes('theme'), 'off: nothing goes out');
  await crdt.recordSettings(database.db, [{ name: 'theme', value: 'dark', at: 10 }, { name: 'reminderTime', value: '450', at: 10 }]);
  await setSyncSettingsOn(true);
  assert.equal(await syncSettings(), true);
  assert.equal(await AsyncStorage.getItem('themePreference'), 'dark', 'adopted from the other device');
  assert.equal(await AsyncStorage.getItem('reminderTime'), '450');
  await AsyncStorage.setItem('themePreference', 'light');
  await syncSettings();
  const theme = (await notes.getSettingsData()).settings.find((e: any) => e.name === 'theme');
  assert.equal(theme.value, 'light', 'a change here goes out');
});
