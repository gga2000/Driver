-- Re-run the Supabase lock-down (20261004210100_supabase_hardening) over the tables added since:
-- notify (push_tokens, notify_preferences, notify_deliveries) and the launch control room (kill
-- switches, capacity, banners, support tickets). Row level security on, nothing granted to Supabase's
-- anon / authenticated roles. Idempotent. Any later migration that creates a table must end with the
-- same call (packages/db/src/supabase-compat.test.ts enforces it).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
