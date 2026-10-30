import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { en } from '../src/i18n/locales/en/index.ts';
import { LANGUAGES } from '../src/i18n/translate.ts';

const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const split = (key: string): [string, string | null] => {
  const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  return m ? [m[1], m[2]] : [key, null];
};
const tokens = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

// base key -> { plural: whether it has forms, tokens: the placeholders used by any form }
const base = new Map<string, { plural: boolean; tokens: Set<string> }>();
for (const [key, text] of Object.entries(en as Record<string, string>)) {
  const [name, form] = split(key);
  const entry = base.get(name) ?? { plural: false, tokens: new Set<string>() };
  entry.plural ||= form !== null;
  tokens(text).forEach(x => entry.tokens.add(x));
  base.set(name, entry);
}

test('English: plural keys come as a pair, and every key has a namespace', () => {
  for (const [name, { plural }] of base) {
    assert.match(name, /^[a-z]+[A-Za-z]*\.[A-Za-z0-9.]+$/, name);
    if (plural) {
      assert.ok(`${name}_one` in en && `${name}_other` in en, `${name} needs _one and _other`);
      assert.ok(!(name in en), `${name} has both a plain key and plural forms`);
    }
  }
});

for (const { code } of LANGUAGES.filter(l => l.code !== 'en')) {
  test(`${code}: same keys and placeholders as English, plural forms for the language`, async () => {
    const file = new URL(`../src/i18n/locales/${code}.ts`, import.meta.url);
    assert.ok(existsSync(file), `locales/${code}.ts is missing`);
    const catalog: Record<string, string> = (await import(file.href)).default;
    const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[];
    const seen = new Set<string>();
    for (const [key, text] of Object.entries(catalog)) {
      const [name, form] = split(key);
      const source = base.get(name);
      assert.ok(source, `${code}: unknown key ${key}`);
      assert.ok(text.trim().length > 0, `${code}: empty ${key}`);
      assert.ok(source.plural === (form !== null) || (!source.plural && form === null), `${code}: ${key} is plural but English is not (or the other way round)`);
      if (form !== null) assert.ok(FORMS.includes(form));
      const used = tokens(text);
      assert.ok([...used].every(x => source.tokens.has(x)), `${code}: ${key} uses a placeholder English does not: ${[...used]}`);
      if (!source.plural) assert.ok(same(used, source.tokens), `${code}: ${key} placeholders differ from English`);
      seen.add(key);
    }
    for (const [name, { plural }] of base) {
      if (!plural) assert.ok(seen.has(name), `${code}: missing ${name}`);
      else for (const form of forms) assert.ok(seen.has(`${name}_${form}`), `${code}: missing ${name}_${form}`);
    }
  });
}
