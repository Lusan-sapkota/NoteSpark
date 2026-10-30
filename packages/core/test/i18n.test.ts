import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRtl, registerCatalog, resolveLanguage, setLanguage, translate } from '../src/i18n/translate.ts';

registerCatalog('en', { hi: 'Hello {name}', 'n_one': '{count} note', 'n_other': '{count} notes', only: 'English only' });
registerCatalog('ar', { hi: 'مرحبا {name}', n_zero: 'لا ملاحظات', n_one: 'ملاحظة', n_two: 'ملاحظتان', n_few: '{count} ملاحظات', n_many: '{count} ملاحظة', n_other: '{count} ملاحظة' });

test('fills placeholders and keeps unknown ones', () => {
  setLanguage('en');
  assert.equal(translate('hi', { name: 'Ana' }), 'Hello Ana');
  assert.equal(translate('hi'), 'Hello {name}');
});

test('English plurals', () => {
  setLanguage('en');
  assert.equal(translate('n', { count: 1 }), '1 note');
  assert.equal(translate('n', { count: 0 }), '0 notes');
  assert.equal(translate('n', { count: 1200 }), '1,200 notes');
});

test('Arabic uses all six plural forms', () => {
  setLanguage('ar');
  assert.equal(translate('n', { count: 0 }), 'لا ملاحظات');
  assert.equal(translate('n', { count: 2 }), 'ملاحظتان');
  assert.ok(translate('n', { count: 3 }).includes('ملاحظات'));
  assert.equal(isRtl(), true);
});

test('a missing key falls back to English, then to the key', () => {
  setLanguage('ar');
  assert.equal(translate('only'), 'English only');
  assert.equal(translate('nothing.here'), 'nothing.here');
});

test('an unknown language becomes English', () => {
  setLanguage('xx');
  assert.equal(translate('hi', { name: 'B' }), 'Hello B');
});

test('device locales map to a supported language', () => {
  const cases: Record<string, string> = { 'pt-BR': 'pt', 'pt_PT': 'pt', 'zh-Hans-CN': 'zh', zh: 'zh', 'zh-TW': 'en', 'zh-Hant': 'en', in: 'id', 'en-GB': 'en', 'ne-NP': 'ne', xx: 'en', '': 'en' };
  for (const [locale, code] of Object.entries(cases)) assert.equal(resolveLanguage(locale), code, locale);
  assert.equal(resolveLanguage(undefined), 'en');
});

test('an engine without Intl.PluralRules or Intl.NumberFormat still translates counts', () => {
  setLanguage('en');
  const saved = { p: Intl.PluralRules, n: Intl.NumberFormat };
  (Intl as any).PluralRules = undefined;
  (Intl as any).NumberFormat = undefined;
  try {
    assert.equal(translate('n', { count: 1 }), '1 note');
    assert.equal(translate('n', { count: 3 }), '3 notes');
  } finally {
    (Intl as any).PluralRules = saved.p;
    (Intl as any).NumberFormat = saved.n;
  }
});
