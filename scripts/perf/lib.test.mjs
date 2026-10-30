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

test('the pinned clock starts at PERF_PIN_CLOCK, keeps running and leaves explicit dates alone', async () => {
  const { execFileSync } = await import('node:child_process');
  const clock = new URL('./clock.mjs', import.meta.url).pathname;
  const out = execFileSync(
    process.execPath,
    [
      '--import',
      clock,
      '-e',
      'const a=Date.now();setTimeout(()=>console.log(JSON.stringify([new Date(a).toISOString(),Date.now()-a>=40,new Date(0).toISOString(),new Date() instanceof Date,typeof Date()])),50)',
    ],
    { env: { ...process.env, PERF_PIN_CLOCK: '2026-10-21T14:30:00Z' }, encoding: 'utf8' },
  );
  const [start, runs, epoch, isDate, str] = JSON.parse(out);
  assert.ok(start.startsWith('2026-10-21T14:30:00'));
  assert.deepEqual([runs, epoch, isDate, str], [true, '1970-01-01T00:00:00.000Z', true, 'string']);
});
