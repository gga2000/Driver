// node --test scripts/ci/release-safety.test.mjs (also run by `pnpm test`). The release path stays one
// path: production deploys only a commit whose required checks passed, the API before the websites, with
// pinned third-party actions; the nightly backup reads its own environment. docs/deploy/runbook.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The text of one top-level job (from `  <name>:` to the next job), for plain-text checks. */
function job(workflow, name) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `job ${name} not found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^ {2}[a-z][\w-]*:\s*$/.test(l) || /^\S/.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

const deploy = read('.github/workflows/deploy.yml');

test('every third-party action in every workflow is pinned to a full commit sha', () => {
  for (const file of ['deploy.yml', 'backup.yml', 'ci.yml', 'staging-setup.yml', 'load-test.yml', 'staging-machines.yml', 'game-day.yml']) {
    const text = read(`.github/workflows/${file}`);
    for (const [, action, ref] of text.matchAll(/uses:\s*([\w.-]+\/[\w./-]+)@([^\s#]+)/g)) {
      if (action.startsWith('actions/')) continue; // GitHub's own actions stay on major tags
      assert.match(ref, /^[0-9a-f]{40}$/, `${file}: ${action}@${ref} must be pinned to a commit sha`);
    }
  }
  // The same Fly setup commit as the other workflows.
  assert.equal([...deploy.matchAll(/superfly\/flyctl-actions\/setup-flyctl@ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1/g)].length, 2);
});

test('the deploy refuses a commit whose ci and e2e-postgres checks did not pass, unless marked urgent', () => {
  const checks = job(deploy, 'checks');
  assert.match(checks, /commits\/\$SHA\/check-runs/);
  assert.match(checks, /ci e2e-postgres/);
  assert.match(checks, /checks: read/);
  assert.match(deploy, /urgent:\n\s+description:[^\n]*\n\s+type: boolean\n\s+default: false/);
  assert.match(checks, /GITHUB_STEP_SUMMARY/, 'an urgent override is written to the job summary');
  // Every other job runs after it: plan needs checks, and every deploying job needs plan.
  assert.match(job(deploy, 'plan'), /needs: checks/);
  for (const name of ['migrate', 'api', 'console', 'web', 'web-vercel']) assert.match(job(deploy, name), /needs: \[?plan/, name);
});

test('CI on main is never cancelled by the next push, so every main commit gets a finished result', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  assert.doesNotMatch(ci, /cancel-in-progress: true/);
});

test('the Vercel websites deploy from the Deploy workflow after the API smoke, not on every merge', () => {
  for (const app of ['customer', 'merchant']) {
    const vercel = JSON.parse(read(`apps/${app}/vercel.json`));
    assert.equal(vercel.git.deploymentEnabled, false, `apps/${app}/vercel.json must not deploy on push`);
  }
  const web = job(deploy, 'web-vercel');
  assert.match(web, /needs: \[plan, api\]/);
  // Only after the API passed its smoke (or when this run does not deploy the API at all).
  for (const name of ['web', 'web-vercel', 'console']) {
    assert.match(job(deploy, name), /needs\.api\.result == 'success' \|\| \(needs\.api\.result == 'skipped' && needs\.plan\.outputs\.api != 'true'\)/, name);
  }
  assert.match(web, /VERCEL_DEPLOY_HOOK_CUSTOMER/);
  assert.match(web, /VERCEL_DEPLOY_HOOK_MERCHANT/);
  assert.match(web, /git\/ref\/heads\/main/, 'a hook builds main, so the job checks the commit is main');
});

test('the runbook rolls the websites back on Vercel', () => {
  const runbook = read('docs/deploy/runbook.md');
  const rollback = runbook.slice(runbook.indexOf('## Roll back'), runbook.indexOf('### A migration failed'));
  assert.match(rollback, /\*\*Web apps\*\*[^*]*Vercel[^*]*\*\*Instant Rollback\*\*/);
  assert.doesNotMatch(rollback, /Cloudflare → the Pages project/);
});

test('the backup job reads its own environment, never the production deploy one', () => {
  const dump = job(read('.github/workflows/backup.yml'), 'dump');
  assert.match(dump, /\n {4}environment: backup\n/);
  assert.match(dump, /BACKUP_HEARTBEAT_URL/);
});
