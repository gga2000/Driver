-- Rename the identifier vault from `vault` to `identity_vault` on databases created before 2026-10-04.
--
-- Supabase installs its own `supabase_vault` extension into a schema named `vault` on every project,
-- owned by `supabase_admin`; the `postgres` role may use it but not create tables in it, so our
-- `CREATE TABLE "vault".…` failed there. The earlier migrations now create `identity_vault`
-- directly (a fresh database, Supabase included, never touches `vault`). A database migrated with
-- the old files still has our tables in `vault`: move them. Detected by our own table, so
-- Supabase's `vault` (which has `secrets`, not `person_identities`) is never renamed.
DO $$
BEGIN
  IF to_regclass('"vault"."person_identities"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'identity_vault') THEN
    ALTER SCHEMA "vault" RENAME TO "identity_vault";
  END IF;
END $$;
