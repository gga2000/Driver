// node --test scripts/ci/check-migrations.test.mjs (also run by `pnpm test`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkMigrations } from './check-migrations.mjs';

const base = [
  '20261003000000_core',
  '20261003000000_vault', // shared on main already: history, never reported
  '20261008130000_vault_accessor_kind',
  '20261008130100_quote_expiry',
];

test('no new migrations: passes even though main has shared timestamps', () => {
  assert.deepEqual(checkMigrations({ head: base, base }).problems, []);
});

test('a new migration later than everything passes', () => {
  const r = checkMigrations({ head: [...base, '20261009090000_scheduled_timers'], base });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.added, ['20261009090000_scheduled_timers']);
});

test('a new migration sharing a timestamp with one on main fails', () => {
  const r = checkMigrations({ head: [...base, '20261008130100_other'], base });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /20261008130100_quote_expiry/);
  assert.match(r.problems[0], /docs\/launch\/migrations\.md/);
});

test('two new migrations sharing a timestamp both fail', () => {
  const r = checkMigrations({ head: [...base, '20261009000000_a', '20261009000000_b'], base });
  assert.equal(r.problems.length, 2);
});

test('a new migration older than the newest on main fails and says to rename it', () => {
  const r = checkMigrations({ head: [...base, '20261007230000_late'], base });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /older than 20261008130100/);
  assert.match(r.problems[0], /Rename it to a timestamp later than 20261008130100/);
  assert.match(r.problems[0], /docs\/launch\/migrations\.md/);
});

test('a new folder without a timestamp fails', () => {
  const r = checkMigrations({ head: [...base, 'add_things'], base });
  assert.equal(r.problems.length, 1);
});

test('an empty base (first migration) passes', () => {
  assert.deepEqual(checkMigrations({ head: ['20261001000000_init'], base: [] }).problems, []);
});
