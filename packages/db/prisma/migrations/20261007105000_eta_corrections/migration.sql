-- One ETA that learns (maps program f7, spec §5.4): the router's leg minutes × a correction factor per
-- zone pair, Baghdad-time bucket, vehicle class and routing basis — an EWMA of actual ÷ predicted over
-- completed legs (`ETA_LEARNING_RULES`). `from_zone` / `to_zone` = '*' is the city level; `hour_bucket`
-- = -1 is all day. `eta_samples` holds one row per learned leg (unique stop), so an outbox redelivery
-- never counts a leg twice. Pseudonymous and position-free. Additive only.

CREATE TABLE "public"."eta_corrections" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "from_zone" TEXT NOT NULL,
    "to_zone" TEXT NOT NULL,
    "hour_bucket" INTEGER NOT NULL,
    "vehicle_class" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "factor" DOUBLE PRECISION NOT NULL,
    "samples" INTEGER NOT NULL,
    "last_sample_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eta_corrections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."eta_samples" (
    "id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "from_zone" TEXT NOT NULL,
    "to_zone" TEXT NOT NULL,
    "hour_bucket" INTEGER NOT NULL,
    "vehicle_class" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "predicted_min" DOUBLE PRECISION NOT NULL,
    "actual_min" DOUBLE PRECISION NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "arrived_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eta_samples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eta_corrections_city_id_from_zone_to_zone_hour_bucket_vehic_key" ON "public"."eta_corrections"("city_id", "from_zone", "to_zone", "hour_bucket", "vehicle_class", "basis");

CREATE UNIQUE INDEX "eta_samples_stop_id_key" ON "public"."eta_samples"("stop_id");

CREATE INDEX "eta_samples_city_id_arrived_at_idx" ON "public"."eta_samples"("city_id", "arrived_at");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
