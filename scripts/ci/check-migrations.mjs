#!/usr/bin/env node
// Migration timestamps (plan §3.2 item 3; docs/ci.md). Compares the migrations in the working tree
// with the base branch and fails when a migration ADDED by this change:
//   - shares its 14-digit timestamp with any other migration, or
//   - is older than the newest migration already on the base branch, or
//   - does not start with a 14-digit timestamp.
// Older migrations that already share a timestamp on the base branch (e.g. 20261003000000_*) are
// history and are not reported.
//
//   node scripts/ci/check-migrations.mjs                 # against origin/main
//   node scripts/ci/check-migrations.mjs --base <ref>    # against any git ref
// On a push (GITHUB_EVENT_NAME=push) it skips: what landed on main was already checked in its PR.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = 'packages/db/prisma/migrations';
const STAMP = /^(\d{14})_/;

const stampOf = (name) => STAMP.exec(name)?.[1] ?? null;

/**
 * head, base: migration directory names (e.g. "20261008130000_vault_accessor_kind").
 * Returns a list of plain-words problems; empty means OK.
 */
export function checkMigrations({ head, base }) {
  const problems = [];
  const baseSet = new Set(base);
  const added = head.filter((name) => !baseSet.has(name)).sort();
  const newestBase = base.map(stampOf).filter(Boolean).sort().at(-1) ?? null;

  for (const name of added) {
    const stamp = stampOf(name);
    if (stamp === null) {
      problems.push(`${name}: a migration folder must start with a 14-digit timestamp (YYYYMMDDHHMMSS_name).`);
      continue;
    }
    const twins = head.filter((other) => other !== name && stampOf(other) === stamp);
    if (twins.length > 0) {
      problems.push(
        `${name}: its timestamp ${stamp} is also used by ${twins.join(', ')}. Rename it to a later, unused timestamp and add a line to docs/launch/migrations.md.`,
      );
    }
    if (newestBase !== null && stamp < newestBase) {
      problems.push(
        `${name}: it is older than ${newestBase}, the newest migration already on the base branch, so it would apply out of order. Rename it to a timestamp later than ${newestBase} and add a line to docs/launch/migrations.md.`,
      );
    }
  }
  return { added, problems };
}

function listHead(root) {
  const dir = join(root, MIGRATIONS_DIR);
  return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
}

function listBase(root, ref) {
  const out = execFileSync('git', ['ls-tree', '--name-only', `${ref}:${MIGRATIONS_DIR}`], { cwd: root, encoding: 'utf8' });
  // ls-tree on a tree lists files too (migration_lock.toml); keep folder-shaped names only.
  return out.split('\n').filter((name) => name !== '' && !name.includes('.'));
}

function main(argv) {
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    console.log('Migration timestamps: skipped on push (checked in the pull request).');
    return 0;
  }
  const i = argv.indexOf('--base');
  const ref = i >= 0 ? argv[i + 1] : 'origin/main';
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const { added, problems } = checkMigrations({ head: listHead(root), base: listBase(root, ref) });
  if (problems.length === 0) {
    console.log(`Migration timestamps: OK against ${ref} (${added.length} new migration(s)${added.length ? `: ${added.join(', ')}` : ''}).`);
    return 0;
  }
  for (const p of problems) console.log(`::error title=Migration timestamps::${p}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
