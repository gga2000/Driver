// node --test scripts/ci/review-gate.test.mjs (also run by `pnpm test`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { decide, freezeTime, gatedFiles, hasReviewLabel } from './review-gate.mjs';

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OLD = '0f9e8d7c6b5a49382716051f2e3d4c5b6a798012';
const base = { files: [], labels: [], headSha: HEAD, commits: [], prNumber: 42, freezeConfig: {} };

test('touching ledger with no label fails', () => {
  const r = decide({ ...base, files: ['apps/api/src/modules/ledger/ledger.service.ts'] });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /reviewed:a1b2c3d4e5f6/);
});

test('a label for an old sha fails, and says a new push needs a new review', () => {
  const r = decide({ ...base, files: ['packages/db/prisma/migrations/20261009000000_x/migration.sql'], labels: [`reviewed:${OLD}`] });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /older commit/);
});

test('a label for the current head passes (full sha or 7+ char prefix)', () => {
  const files = ['apps/api/src/modules/identity/otp.ts'];
  assert.equal(decide({ ...base, files, labels: [`reviewed:${HEAD}`] }).ok, true);
  assert.equal(decide({ ...base, files, labels: ['reviewed:a1b2c3d'] }).ok, true);
  assert.equal(decide({ ...base, files, labels: ['reviewed:A1B2C3D4'] }).ok, true);
  assert.equal(decide({ ...base, files, labels: ['reviewed:a1b2c3'] }).ok, false, 'six characters is too short');
});

test('an untouched PR passes with no label', () => {
  const r = decide({ ...base, files: ['apps/customer/src/screens/home.tsx', 'packages/i18n/src/locales/en.json'] });
  assert.equal(r.ok, true);
});

test('every gated path is recognised, and look-alikes are not', () => {
  const gated = [
    'apps/api/src/modules/orders/x.ts',
    'apps/api/src/modules/routes/x.ts',
    'apps/api/src/modules/topups/x.ts',
    'apps/api/src/modules/referrals/x.ts',
    'apps/api/src/modules/identity/sub/x.ts',
    'packages/db/prisma/migrations/migration_lock.toml',
    'packages/db/prisma/schema.prisma',
    'apps/api/src/modules/notify/providers/sms.ts',
    'apps/api/src/trpc/trpc.module.ts',
    'scripts/ci/review-gate.mjs',
  ];
  assert.equal(gatedFiles(gated).length, gated.length);
  const free = ['apps/api/src/modules/notify/notify.service.ts', 'apps/api/src/modules/ordersx/x.ts', 'apps/api/src/trpc/router.ts', 'packages/db/prisma/seed.ts'];
  assert.deepEqual(gatedFiles(free), []);
});

test('hasReviewLabel ignores unrelated labels', () => {
  assert.equal(hasReviewLabel(['freeze', 'reviewed', 'reviewed:zzzzzzz'], HEAD), false);
});

const FREEZE = '2026-10-07T20:27:00Z';
const before = '2026-10-07T19:00:00Z';
const after = '2026-10-07T21:00:00Z';
const commit = (message, date) => ({ sha: HEAD, message, date });

test('a feat: commit after the freeze fails', () => {
  const r = decide({ ...base, labels: ['freeze', `freeze:${FREEZE}`], commits: [commit('feat: one more thing', after)] });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /feat: one more thing/);
});

test('fix:, test:, rebase: and merge commits after the freeze pass; anything before it passes', () => {
  const commits = [
    commit('feat: before the freeze', before),
    commit('fix: wrong total', after),
    commit('fix(api): scoped', after),
    commit('test: cover it', after),
    commit('rebase: resolve conflict with main', after),
    commit("Merge branch 'main' into lane-a", after),
  ];
  const r = decide({ ...base, labels: ['freeze', `freeze:${FREEZE}`], commits });
  assert.equal(r.ok, true, r.lines.join('\n'));
});

test('the freeze time comes from freeze.json when there is no freeze:<time> label', () => {
  const freezeConfig = JSON.parse(readFileSync(new URL('./freeze.json', import.meta.url), 'utf8'));
  assert.equal(freezeConfig['8'], FREEZE);
  const r = decide({ ...base, prNumber: 8, freezeConfig, labels: ['freeze'], commits: [commit('chore: tidy', after)] });
  assert.equal(r.ok, false);
  assert.equal(decide({ ...base, prNumber: 8, freezeConfig, labels: ['freeze'], commits: [commit('chore: tidy', before)] }).ok, true);
});

test('the label wins over freeze.json, and a bad or missing time fails', () => {
  assert.equal(freezeTime([`freeze:2026-10-08T00:00:00Z`], 8, { 8: FREEZE }).time.toISOString(), '2026-10-08T00:00:00.000Z');
  assert.ok(freezeTime(['freeze:yesterday'], 8, {}).error);
  assert.equal(decide({ ...base, labels: ['freeze'] }).ok, false);
});

test('without the freeze label, commits are not checked', () => {
  assert.equal(decide({ ...base, commits: [commit('feat: anything', after)], freezeConfig: { 42: FREEZE } }).ok, true);
});
