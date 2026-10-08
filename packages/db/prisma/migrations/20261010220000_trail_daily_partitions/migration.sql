-- Trail points by day (speed audit z1/z2, CRIT3-02, SCALE-23). At launch size trails grow about
-- 155 MB a day and are kept 30 days (decision D6). With monthly partitions every expired point had to
-- be DELETEd row by row (bloat, WAL, vacuum); with daily partitions a whole expired day is detached
-- and dropped, which costs nothing. The API creates the next days' partitions every hour and drops
-- the expired ones (apps/api/src/modules/retention/trail-retention.ts).
--
-- Days inside a monthly partition made before this migration (`trail_points_YYYY_MM`) stay there;
-- that partition is dropped whole once its month has expired. New days get `trail_points_YYYY_MM_DD`.
-- No table is created here: the function creates partitions later, each with RLS on.
CREATE OR REPLACE FUNCTION "public"."ensure_trail_day_partition"(day DATE)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  part_name TEXT := 'trail_points_' || to_char(day, 'YYYY_MM_DD');
  month_part TEXT := 'trail_points_' || to_char(day, 'YYYY_MM');
BEGIN
  IF to_regclass('"public".' || quote_ident(month_part)) IS NOT NULL THEN
    RETURN;
  END IF;
  IF to_regclass('"public".' || quote_ident(part_name)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE "public".%I PARTITION OF "public"."trail_points" FOR VALUES FROM (%L) TO (%L)',
      part_name, day::timestamp, (day + 1)::timestamp
    );
    EXECUTE format('ALTER TABLE "public".%I ENABLE ROW LEVEL SECURITY', part_name);
  END IF;
END $$;

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
