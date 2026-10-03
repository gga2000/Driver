/**
 * `pnpm sim --orders 2000 --drivers 60 --restaurants 10 --seed 1 [--ci] [--report path]`
 * The Aziziyah simulator gate (plan Step 7, docs/ci.md "Simulate"). It always runs in memory:
 * the database and Redis URLs are dropped before the app boots, whatever the shell or CI set.
 */
delete process.env['DATABASE_URL'];
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
