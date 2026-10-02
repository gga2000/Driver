import { createApp } from './bootstrap.js';

const port = Number(process.env['PORT'] ?? 3000);

createApp()
  .then(async (app) => {
    await app.listen(port);
    console.log(`driver-api listening on http://localhost:${port}/trpc`);
  })
  .catch((err: unknown) => {
    console.error('failed to boot driver-api', err);
    process.exit(1);
  });
