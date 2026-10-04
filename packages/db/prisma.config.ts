import { defineConfig } from 'prisma/config';

// Prisma 7 reads connection strings only from this file (never from schema.prisma). Both are optional so
// `prisma generate` / `prisma validate` keep working with no database; `migrate deploy` needs a URL,
// and `migrate diff --from-migrations` (the CI drift check, `pnpm db:drift`) needs SHADOW_DATABASE_URL.
//
// The CLI (migrate, studio) prefers DIRECT_URL: on Supabase, DATABASE_URL is the Supavisor pooler in
// transaction mode (port 6543) that the API uses at runtime, while migrations need a session — the
// direct or session-mode connection (port 5432). Elsewhere (laptop, CI) DIRECT_URL is unset and
// DATABASE_URL is used for both. The runtime client never reads this file (createPrisma takes its URL).
const url = process.env['DIRECT_URL'] || process.env['DATABASE_URL'];
const shadowDatabaseUrl = process.env['SHADOW_DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    ...(url ? { url } : {}),
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
