import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { judge, report } from './lib.mjs';

test('judge: over max fails, at max passes, missing fails, extra is report-only', () => {
  const r = judge({ a: { max: 5 }, b: { max: 5, target: 1 }, c: { max: 1 } }, { a: 5, b: 6, d: 3 });
  assert.deepEqual(
    r.rows.map((x) => [x.key, x.ok]),
    [
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', true],
    ],
  );
  assert.equal(r.ok, false);
  assert.match(report('T', r), /OVER BUDGET/);
});

test('budgets.json: every budget has a numeric max and a target (if any) at or under it', () => {
  const budgets = JSON.parse(readFileSync(new URL('./budgets.json', import.meta.url), 'utf8'));
  for (const group of ['size', 'screens']) {
    for (const [key, b] of Object.entries(budgets[group])) {
      assert.equal(typeof b.max, 'number', key);
      if (b.target !== undefined) assert.ok(b.target <= b.max, key);
    }
  }
});
