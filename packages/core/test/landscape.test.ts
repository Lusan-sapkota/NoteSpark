import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLandscape, kmeans, MIN_LANDSCAPE_NOTES, project, termsOf } from '../src/landscape.ts';
import type { LandscapeNote } from '../src/landscape.ts';

const unit = (v: number[]) => { const n = Math.hypot(...v); return v.map(x => x / n); };
const axes = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
// Eight notes per group, each a little off the group's axis.
const make = (): LandscapeNote[] =>
  axes.flatMap((axis, g) =>
    Array.from({ length: 8 }, (_, i) => ({
      id: g * 100 + i,
      title: ['Pasta dinner plans', 'Trip itinerary Lisbon', 'Budget spreadsheet review'][g] + ` ${i}`,
      content: [`#cooking sauce recipe pasta ${i}`, `flights hotel Lisbon trip ${i}`, `budget spreadsheet ledger ${i}`][g],
      createdAt: g === 0 ? `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00.000Z` : g === 1 ? `2026-03-0${1 + i % 8}T10:00:00.000Z` : `2026-05-0${1 + i % 8}T10:00:00.000Z`,
      vector: unit(axis.map((x, d) => x + (d === 3 ? 0 : 0.05 * Math.sin(i * 7 + d + g)) + (d === 3 ? 0.04 * Math.cos(i) : 0))),
    })));

test('groups notes that are close in meaning, the same way every time', () => {
  const notes = make();
  const a = kmeans(notes.map(n => n.vector), 3, 24);
  const b = kmeans(notes.map(n => n.vector), 3, 24);
  assert.deepEqual(a.groups, b.groups);
  for (let g = 0; g < 3; g++) assert.equal(new Set(a.groups.slice(g * 8, g * 8 + 8)).size, 1, `group ${g} stays together`);
  assert.equal(new Set(a.groups).size, 3);
});

test('names topics from a tag, else from words the group uses and the rest do not', () => {
  const { topics } = buildLandscape(make(), '2026-10-30T00:00:00.000Z');
  assert.equal(topics.length, 3);
  assert.deepEqual(topics.map(t => t.size), [8, 8, 8]);
  const names = topics.map(t => t.name);
  assert.ok(names.includes('cooking'), names.join('|'));
  assert.ok(names.some(n => /lisbon|flights|hotel|trip|itinerary/.test(n)), names.join('|'));
  assert.ok(names.some(n => n.includes('budget') || n.includes('spreadsheet') || n.includes('ledger')), names.join('|'));
});

test('counts notes per month and finds what is rising and fading', () => {
  const l = buildLandscape(make(), '2026-10-30T00:00:00.000Z');
  assert.equal(l.months.length, 12);
  assert.equal(l.months.at(-1), '2026-10');
  const cooking = l.topics.findIndex(t => t.name === 'cooking');
  assert.equal(l.topics[cooking].monthly.at(-1), 8);
  assert.deepEqual(l.rising, [cooking]);
  // May is in the three months before the last three (Aug to Oct); March is older than both.
  const budget = l.topics.findIndex(t => /budget|ledger|spreadsheet/.test(t.name));
  assert.deepEqual(l.fading, [budget]);
});

test('needs a few notes, and puts every topic on the map', () => {
  assert.equal(buildLandscape(make().slice(0, MIN_LANDSCAPE_NOTES - 1), '2026-10-30T00:00:00.000Z').topics.length, 0);
  for (const t of buildLandscape(make(), '2026-10-30T00:00:00.000Z').topics) assert.ok(t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1);
  assert.equal(project([[1, 0], [0, 1]]).length, 2);
});

test('terms: words, and pairs of characters for scripts written without spaces', () => {
  assert.deepEqual([...termsOf('The Pasta, pasta! 2026 a')], ['pasta']);
  assert.deepEqual([...termsOf('日本語のメモ')].sort(), ['のメ', 'メモ', '本語', '日本', '語の'].sort());
});
