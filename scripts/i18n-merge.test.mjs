// node --test scripts/i18n-merge.test.mjs (also run by `pnpm test`).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { formatEntries, mergeLocales } from './i18n-merge.mjs';

const DRIVER = fileURLToPath(new URL('./i18n-merge.mjs', import.meta.url));
const keys = (r) => r.entries.map(([k]) => k);
const obj = (r) => Object.fromEntries(r.entries);

const base = { 'a.one': '1', 'a.two': '2', 'b.one': 'B1', 'b.two': 'B2' };

test('clean union: each side adds keys in its own group; ours order kept, theirs keys after their predecessor', () => {
  const ours = { 'a.one': '1', 'a.two': '2', 'a.three': '3', 'b.one': 'B1', 'b.two': 'B2' };
  const theirs = { 'a.one': '1', 'a.two': '2', 'b.one': 'B1', 'b.one_and_half': 'B1.5', 'b.two': 'B2', 'c.one': 'C1' };
  const r = mergeLocales(base, ours, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(keys(r), ['a.one', 'a.two', 'a.three', 'b.one', 'b.one_and_half', 'b.two', 'c.one']);
});

test('a new key at the very top of theirs goes to the top', () => {
  const r = mergeLocales(base, base, { 'a.zero': '0', ...base });
  assert.deepEqual(keys(r).slice(0, 2), ['a.zero', 'a.one']);
});

test('one side edits, the other leaves it: the edit wins; both make the same edit: fine', () => {
  const r = mergeLocales(base, { ...base, 'a.one': 'one' }, { ...base, 'b.two': 'two' });
  assert.deepEqual(r.conflicts, []);
  assert.equal(obj(r)['a.one'], 'one');
  assert.equal(obj(r)['b.two'], 'two');
  assert.deepEqual(mergeLocales(base, { ...base, 'a.one': 'x' }, { ...base, 'a.one': 'x' }).conflicts, []);
});

test('conflict: both sides change the same key to different values', () => {
  const r = mergeLocales(base, { ...base, 'a.two': 'ours' }, { ...base, 'a.two': 'theirs', 'c.new': 'n' });
  assert.deepEqual(r.conflicts, ['a.two']);
  const text = formatEntries(r.entries);
  assert.match(text, /<<<<<<< ours\n {2}"a\.two": "ours",\n=======\n {2}"a\.two": "theirs",\n>>>>>>> theirs/);
  assert.throws(() => JSON.parse(text), 'a conflicted file must not parse');
});

test('conflict: both sides add the same new key with different values', () => {
  assert.deepEqual(mergeLocales(base, { ...base, 'x.k': '1' }, { ...base, 'x.k': '2' }).conflicts, ['x.k']);
});

test('deletion: a key deleted on one side and unchanged on the other is deleted', () => {
  const { 'a.two': _a, ...oursDel } = base;
  const { 'b.one': _b, ...theirsDel } = base;
  const r = mergeLocales(base, oursDel, theirsDel);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(keys(r), ['a.one', 'b.two']);
});

test('deletion vs edit is a conflict', () => {
  const { 'a.two': _a, ...oursDel } = base;
  const r = mergeLocales(base, oursDel, { ...base, 'a.two': 'edited' });
  assert.deepEqual(r.conflicts, ['a.two']);
  assert.match(formatEntries(r.entries), /deleted on this side/);
});

test('output matches the locale file format byte for byte (no-op merge of the real file)', () => {
  const path = fileURLToPath(new URL('../packages/i18n/src/locales/ar-IQ.json', import.meta.url));
  const text = readFileSync(path, 'utf8');
  const json = JSON.parse(text);
  assert.equal(formatEntries(mergeLocales(json, json, json).entries), text);
});

test('CLI: writes the merge into %A and exits 0; exits 1 and names the keys on a conflict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-merge-'));
  try {
    const write = (name, o) => {
      writeFileSync(join(dir, name), `${JSON.stringify(o, null, 2)}\n`);
      return join(dir, name);
    };
    let [O, A, B] = [write('O', base), write('A', { 'a.one': '1', 'a.two': '2', 'a.three': '3', 'b.one': 'B1', 'b.two': 'B2' }), write('B', { ...base, 'b.three': 'B3' })];
    let run = spawnSync(process.execPath, [DRIVER, O, A, B], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(A, 'utf8'))), ['a.one', 'a.two', 'a.three', 'b.one', 'b.two', 'b.three']);

    [O, A, B] = [write('O', base), write('A', { ...base, 'b.one': 'x' }), write('B', { ...base, 'b.one': 'y' })];
    run = spawnSync(process.execPath, [DRIVER, O, A, B], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /b\.one/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git uses it as a merge driver: two branches adding keys to the same spot merge cleanly', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) return t.skip('git not installed');
  const dir = mkdtempSync(join(tmpdir(), 'i18n-merge-git-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', `merge.i18n-json.driver=node "${DRIVER}" %O %A %B`, ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, '.gitattributes'), 'l.json merge=i18n-json\n');
    const put = (o) => writeFileSync(join(dir, 'l.json'), `${JSON.stringify(o, null, 2)}\n`);
    put(base);
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'side');
    put({ 'a.one': '1', 'a.two': '2', 'a.side': 'S', 'b.one': 'B1', 'b.two': 'B2' });
    git('commit', '-qam', 'side');
    git('checkout', '-q', 'main');
    put({ 'a.one': '1', 'a.two': '2', 'a.main': 'M', 'b.one': 'B1', 'b.two': 'B2' });
    git('commit', '-qam', 'main');
    git('merge', '-q', '--no-edit', 'side');
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'l.json'), 'utf8'))), ['a.one', 'a.two', 'a.main', 'a.side', 'b.one', 'b.two']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
