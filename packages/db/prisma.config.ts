import { defineConfig } from 'prisma/config';

// Prisma 7 reads connection strings only from this file (never from schema.prisma). Both are optional so
// `prisma generate` / `prisma validate` keep working with no database; `migrate deploy` needs DATABASE_URL,
// and `migrate diff --from-migrations` (the CI drift check, `pnpm db:drift`) needs SHADOW_DATABASE_URL.
const url = process.env['DATABASE_URL'];
const shadowDatabaseUrl = process.env['SHADOW_DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    ...(url ? { url } : {}),
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
