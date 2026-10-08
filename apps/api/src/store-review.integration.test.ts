import { describe } from 'vitest';
import { storeReviewSuite } from './store-review.suite.js';

/** BENCH-04 on a real Postgres (migrated): the same walk through the Prisma repositories. Skipped without DATABASE_URL. */
if (process.env['DATABASE_URL']) storeReviewSuite({ database: true });
else describe.skip('the store reviewers test kitchen (needs DATABASE_URL)', () => undefined);
