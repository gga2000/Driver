-- Lock the database down for Supabase (docs/deploy/supabase.md). Safe and idempotent everywhere:
-- on plain Postgres (laptop, CI) the Supabase roles do not exist and only the RLS part does anything.
--
-- The API is the only client of this database. It connects as the role that owns every table
-- (`postgres` on Supabase), and row level security never restricts a table's owner (no FORCE), so
-- nothing here changes what the API can do. What it closes is Supabase's own Data API: PostgREST and
-- pg_graphql serve the `public` schema to the `anon` and `authenticated` roles (anyone holding the
-- project's publishable/anon key), and on many projects every new table in `public` is granted to
-- them by default.
--
--   1. `driver_harden(app_schemas, vault_schema)` — run here, and again after every deploy
--      (scripts/deploy/supabase-setup.mjs, .github/workflows/deploy.yml) so tables added by later
--      migrations are covered too:
--        * ROW LEVEL SECURITY on every table we own in the app schemas (partitions included), with no
--          policies: any role other than the owner sees zero rows;
--        * REVOKE ALL on those tables, their sequences and our functions from anon / authenticated
--          (and EXECUTE on our functions from PUBLIC);
--        * the identity vault: REVOKE ALL on the schema and its tables from PUBLIC, anon,
--          authenticated and service_role — only the owner (the API) may even look inside;
--        * ALTER DEFAULT PRIVILEGES so tables, sequences and functions created later by this role are
--          not granted to anon / authenticated in the first place.
--      Tables owned by an extension (PostGIS's spatial_ref_sys) and objects we do not own are skipped.
--      Returns one row per change, for the setup script's log.
--   2. `ensure_trail_partition` also enables RLS on each monthly partition it creates.
--
-- No superuser-only statements: everything runs as the schema owner (Supabase's `postgres`).

CREATE OR REPLACE FUNCTION "public"."driver_harden"(app_schemas TEXT[], vault_schema TEXT)
RETURNS TABLE (object TEXT, action TEXT) LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  api_roles TEXT;
  vault_roles TEXT;
  s TEXT;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO api_roles
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
  SELECT string_agg(x, ', ') INTO vault_roles FROM (
    SELECT 'PUBLIC' AS x
    UNION ALL
    SELECT quote_ident(rolname) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
  ) q;

  -- 1. Row level security on every table and partition we own (never an extension's own table).
  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (app_schemas)
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
      AND pg_has_role(current_user, c.relowner, 'USAGE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.nspname, r.relname);
    object := r.nspname || '.' || r.relname; action := 'row level security enabled'; RETURN NEXT;
  END LOOP;

  -- 2. Supabase's API roles get nothing: tables, sequences and our functions.
  IF api_roles IS NOT NULL THEN
    FOR r IN
      SELECT n.nspname, c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY (app_schemas)
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND pg_has_role(current_user, c.relowner, 'USAGE')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
        AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
      ORDER BY 1, 2
    LOOP
      EXECUTE format('REVOKE ALL ON %s %I.%I FROM %s', CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.nspname, r.relname, api_roles);
      object := r.nspname || '.' || r.relname; action := 'revoked from ' || api_roles; RETURN NEXT;
    END LOOP;
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = ANY (app_schemas)
      AND pg_has_role(current_user, p.proowner, 'USAGE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND (has_function_privilege('public', p.oid, 'EXECUTE')
        OR (api_roles IS NOT NULL AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))))
    ORDER BY 1
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', r.sig, 'PUBLIC' || coalesce(', ' || api_roles, ''));
    object := r.sig; action := 'execute revoked from PUBLIC' || coalesce(', ' || api_roles, ''); RETURN NEXT;
  END LOOP;

  -- 3. The identity vault: no role but its owner may use the schema or read a table in it.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = vault_schema AND pg_has_role(current_user, nspowner, 'USAGE')) THEN
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %s', vault_schema, vault_roles);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %s', vault_schema, vault_roles);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %s', vault_schema, vault_roles);
    object := vault_schema; action := 'schema and tables revoked from ' || vault_roles; RETURN NEXT;
  END IF;

  -- 4. Objects this role creates later in the app schemas are not granted to the API roles.
  IF api_roles IS NOT NULL THEN
    FOREACH s IN ARRAY app_schemas LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %s', s, api_roles);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %s', s, api_roles);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %s', s, api_roles);
    END LOOP;
  END IF;
END $$;

-- Each new monthly trail partition starts with RLS on (same body as 20261002000000_m2_domain, plus that).
CREATE OR REPLACE FUNCTION "public"."ensure_trail_partition"(month_start DATE)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  part_name TEXT := 'trail_points_' || to_char(month_start, 'YYYY_MM');
  range_start TIMESTAMP := date_trunc('month', month_start)::timestamp;
  range_end TIMESTAMP := (date_trunc('month', month_start) + interval '1 month')::timestamp;
BEGIN
  -- Look in this schema only: a same-named partition elsewhere must not suppress this one.
  IF to_regclass('"public".' || quote_ident(part_name)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE "public".%I PARTITION OF "public"."trail_points" FOR VALUES FROM (%L) TO (%L)',
      part_name, range_start, range_end
    );
    EXECUTE format('ALTER TABLE "public".%I ENABLE ROW LEVEL SECURITY', part_name);
  END IF;
END $$;

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
