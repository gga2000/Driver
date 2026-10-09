/**
 * `pnpm sim --orders 2000 --drivers 60 --restaurants 10 --seed 1 [--ci] [--report path] [--db postgres]`
 * The Aziziyah simulator gate (plan Step 7, docs/ci.md "Simulate"). By default it runs in memory: the
 * database and Redis URLs are dropped before the app boots, whatever the shell or CI set.
 *
 * `--db postgres` (CRIT3-05) keeps DATABASE_URL, so every repository is the real Prisma one on
 * Postgres; Redis is still dropped, so the timer queues stay in memory on the fake clock. The run then
 * also fails on any failed Prisma query and on any outbox delivery that needed a retry.
 */
const db = process.argv[process.argv.indexOf('--db') + 1];
if (process.argv.includes('--db') && db === 'postgres') {
  if (!process.env['DATABASE_URL']) {
    console.error('--db postgres needs DATABASE_URL (a migrated and seeded database)');
    process.exit(2);
  }
} else {
  delete process.env['DATABASE_URL'];
}
delete process.env['REDIS_URL'];

const { runCli } = await import('./sim-cli.js');

runCli(process.argv.slice(2))
  .then(({ code }) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
