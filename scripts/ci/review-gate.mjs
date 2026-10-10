#!/usr/bin/env node
// review-gate: the required check that stands in for GitHub's "approving review" (every thread pushes
// as the same GitHub user, so that rule could never be met). Plan §3.2 items 2–3; docs/ci.md.
//
// 1. A PR touching money (the money rules, the modules that move money, or any API file that starts
//    using the ledger), sign-in, vault, migrations, notify providers or trpc.module.ts passes only
//    with a label `reviewed:<sha>` naming its CURRENT head commit (full sha, or a 7+ character
//    prefix). Only the reviewer thread sets it, so a new push needs a new review.
// 2. A PR labelled `freeze` passes only if every commit authored after the freeze time starts with
//    `fix:`, `test:` or `rebase:` (a scope such as `fix(api):` is fine). Merge commits ("Merge …")
//    are allowed. The freeze time comes from a `freeze:<ISO time>` label, else scripts/ci/freeze.json
//    (keyed by PR number). The author date is used, so rebasing older commits does not move them
//    past the freeze.
//
// In Actions it reads the pull_request event and asks the GitHub API (GITHUB_TOKEN, read-only) for
// the PR's changed files, commits and current labels. The decision logic is pure and exported for
// scripts/ci/review-gate.test.mjs.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Paths that need an independent review. Each entry: [regex, plain-words description]. */
export const GATED_PATHS = [
  [/^apps\/api\/src\/modules\/(ledger|orders|routes|topups|referrals)\//, 'money modules'],
  [/^packages\/contracts\/src\/ledger-rules\.ts$/, 'money rules'],
  // Modules that pay out, refund, credit or price: support credits, ops cash, control-room actions, the
  // late-promise credit, merchant payouts, pricing, khat subscriptions, driver earnings.
  [/^apps\/api\/src\/modules\/(support|ops|control-room|tracking|merchant-admin|pricing|khat|driver-account)\//, 'modules that move money'],
  [/^apps\/api\/src\/modules\/identity\//, 'sign-in (identity module)'],
  [/^packages\/db\/prisma\/migrations\//, 'database migrations'],
  [/^packages\/db\/prisma\/schema\.prisma$/, 'database schema (vault and money)'],
  [/^apps\/api\/src\/modules\/notify\/providers\//, 'notify providers'],
  [/^apps\/api\/src\/trpc\/trpc\.module\.ts$/, 'trpc.module.ts'],
  // The gate itself: otherwise a PR could loosen the rules it is judged by.
  [/^(scripts\/ci\/review-gate\.mjs|scripts\/ci\/freeze\.json|\.github\/workflows\/review-gate\.yml)$/, 'the review gate itself'],
  // The e2e ratchet: adding a flow here would let a broken money/sign-in flow pass e2e-postgres.
  [/^scripts\/e2e\/known-failures\.json$/, 'e2e known-failures list'],
];

/** An added line importing the ledger module (API modules only reach it through its index). */
const ADDS_LEDGER_IMPORT = /^\+(?!\+\+).*from\s+['"][./]*(?:modules\/)?ledger\/index(?:\.js)?['"]/m;

/**
 * Changed files that fall under a gated path, with the reason. `patches` (file → unified diff, as the
 * GitHub API returns it) also catches an API file anywhere that starts using the ledger.
 */
export function gatedFiles(files, patches = {}) {
  const out = [];
  for (const file of files) {
    const hit = GATED_PATHS.find(([re]) => re.test(file));
    if (hit) out.push({ file, reason: hit[1] });
    else if (file.startsWith('apps/api/src/') && ADDS_LEDGER_IMPORT.test(patches[file] ?? '')) {
      out.push({ file, reason: 'starts using the ledger' });
    }
  }
  return out;
}

const REVIEWED = /^reviewed:([0-9a-f]{7,40})$/i;

/** True when some `reviewed:<sha>` label names the current head (full sha or a 7+ char prefix). */
export function hasReviewLabel(labels, headSha) {
  const head = String(headSha).toLowerCase();
  return labels.some((label) => {
    const m = REVIEWED.exec(label.trim());
    return m !== null && head.startsWith(m[1].toLowerCase());
  });
}

const FREEZE_TIME = /^freeze:(.+)$/;

/**
 * The freeze time for a PR: a `freeze:<ISO time>` label wins, else freezeConfig[prNumber].
 * Returns { time: Date } or { error: string } or { time: null } when none is set.
 */
export function freezeTime(labels, prNumber, freezeConfig = {}) {
  const label = labels.map((l) => l.trim()).find((l) => FREEZE_TIME.test(l));
  const raw = label ? FREEZE_TIME.exec(label)[1].trim() : freezeConfig[String(prNumber)];
  if (raw === undefined || raw === null || raw === '') return { time: null };
  const time = new Date(raw);
  if (Number.isNaN(time.getTime())) {
    return { error: `the freeze time "${raw}" (${label ? `label ${label}` : 'scripts/ci/freeze.json'}) is not a valid ISO time` };
  }
  return { time };
}

const ALLOWED_AFTER_FREEZE = /^(fix|test|rebase)(\([^)]*\))?!?:/;

/** Commits authored after the freeze that are neither fix:/test:/rebase: nor merge commits. */
export function freezeViolations(commits, time) {
  return commits.filter((c) => {
    if (new Date(c.date).getTime() <= time.getTime()) return false;
    const subject = c.message.split('\n')[0];
    if (subject.startsWith('Merge ')) return false;
    return !ALLOWED_AFTER_FREEZE.test(subject);
  });
}

/**
 * The whole decision.
 * input: { files: string[], patches?: {[file]: diff}, labels: string[], headSha, commits: {sha, message, date}[], prNumber, freezeConfig }
 * returns { ok: boolean, lines: string[] } — lines explain the verdict in plain words.
 */
export function decide({ files, patches = {}, labels, headSha, commits, prNumber, freezeConfig = {} }) {
  const lines = [];
  let ok = true;

  const gated = gatedFiles(files, patches);
  if (gated.length === 0) {
    lines.push('Review: no money, sign-in, vault, migration, notify-provider or trpc.module.ts file changed; no review label needed.');
  } else if (hasReviewLabel(labels, headSha)) {
    lines.push(`Review: ${gated.length} gated file(s) changed and the label reviewed:${String(headSha).slice(0, 7)}… matches the current head. OK.`);
  } else {
    ok = false;
    const stale = labels.filter((l) => REVIEWED.test(l.trim()));
    lines.push(`Review: this PR changes ${gated.length} file(s) that need an independent review:`);
    for (const g of gated) lines.push(`  - ${g.file} (${g.reason})`);
    lines.push(`It needs the label reviewed:${headSha} (or reviewed:${String(headSha).slice(0, 7)}), set by the reviewer thread after reviewing this exact commit.`);
    if (stale.length > 0) {
      lines.push(`Found ${stale.join(', ')}, which names an older commit: a new push needs a new review.`);
    }
  }

  if (labels.some((l) => l.trim() === 'freeze')) {
    const ft = freezeTime(labels, prNumber, freezeConfig);
    if (ft.error) {
      ok = false;
      lines.push(`Freeze: ${ft.error}.`);
    } else if (ft.time === null) {
      ok = false;
      lines.push(`Freeze: the PR is labelled freeze but has no freeze time; add a label freeze:<ISO time> or an entry for #${prNumber} in scripts/ci/freeze.json.`);
    } else {
      const bad = freezeViolations(commits, ft.time);
      if (bad.length === 0) {
        lines.push(`Freeze: since ${ft.time.toISOString()} only fix:, test:, rebase: and merge commits. OK.`);
      } else {
        ok = false;
        lines.push(`Freeze: since ${ft.time.toISOString()} only fix:, test: and rebase: commits may land on this PR. These do not:`);
        for (const c of bad) lines.push(`  - ${c.sha.slice(0, 7)} ${c.message.split('\n')[0]}`);
      }
    }
  }

  return { ok, lines };
}

// ---------------------------------------------------------------------------------------------
// GitHub glue (not unit-tested; kept thin).

async function gh(path, token) {
  const res = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function ghAll(path, token) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await gh(`${path}${sep}per_page=100&page=${page}`, token);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !token || !repo) {
    console.error('review-gate runs in GitHub Actions on pull_request events (needs GITHUB_EVENT_PATH, GITHUB_TOKEN, GITHUB_REPOSITORY).');
    process.exit(2);
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    console.log('Not a pull_request event; nothing to check.');
    return;
  }
  const n = pr.number;
  const [files, commits, labels] = await Promise.all([
    ghAll(`/repos/${repo}/pulls/${n}/files`, token),
    ghAll(`/repos/${repo}/pulls/${n}/commits`, token),
    // Fresh labels, so a re-run after labelling sees the label even on an old event payload.
    ghAll(`/repos/${repo}/issues/${n}/labels`, token),
  ]);
  const here = dirname(fileURLToPath(import.meta.url));
  const freezeConfig = JSON.parse(readFileSync(join(here, 'freeze.json'), 'utf8'));

  const { ok, lines } = decide({
    files: files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename])),
    patches: Object.fromEntries(files.map((f) => [f.filename, f.patch ?? ''])),
    labels: labels.map((l) => l.name),
    headSha: pr.head.sha,
    commits: commits.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.author?.date ?? c.commit.committer?.date })),
    prNumber: n,
    freezeConfig,
  });
  for (const line of lines) console.log(line);
  if (!ok) {
    console.log(`::error title=review-gate::${lines.filter((l) => !l.startsWith('  ')).join(' ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
