-- خطوط sweep alerts (partner S-6; Ali 2026-10-06): a run whose last child stop settled more than
-- `KHAT_RULES.sweepAlertAfterMin` minutes ago without the driver's "تأكدت، السيارة فاضية" raises one
-- alert for dispatchers (Console safety strip) and a reminder push to the driver. One row per run;
-- the driver's late confirm sets `confirmed_at`. Pseudonymous (person ids only). Additive only.

CREATE TABLE "public"."khat_sweep_alerts" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "children_total" INTEGER NOT NULL,
    "last_drop_at" TIMESTAMP(3),
    "last_drop_zone" TEXT,
    "run_ended_at" TIMESTAMP(3) NOT NULL,
    "raised_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "khat_sweep_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "khat_sweep_alerts_trip_id_key" ON "public"."khat_sweep_alerts"("trip_id");

CREATE INDEX "khat_sweep_alerts_city_id_raised_at_idx" ON "public"."khat_sweep_alerts"("city_id", "raised_at");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
