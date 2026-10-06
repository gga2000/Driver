-- Drivers confirm zones (maps program SP3 §5.3, decision D4 "Ali places them, drivers confirm"): at
-- the drop-off that ends a trip, a driver whose precise arrival fix lies inside a placed outline may be
-- asked «انت بمنطقة X؟». One row per stop, at most one per driver per Baghdad day. `outline_at` is the
-- zone's `placed_at` when asked, so a redrawn outline starts counting again. 3 "yes" from 2+ drivers
-- confirm the zone; a "no" flags it in the Console zone tool. Pseudonymous (person ids only). Additive only.

CREATE TABLE "public"."zone_checks" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "zone_key" TEXT NOT NULL,
    "outline_at" TIMESTAMP(3) NOT NULL,
    "driver_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "asked_at" TIMESTAMP(3) NOT NULL,
    "answer" TEXT,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zone_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zone_checks_stop_id_key" ON "public"."zone_checks"("stop_id");

CREATE INDEX "zone_checks_driver_id_asked_at_idx" ON "public"."zone_checks"("driver_id", "asked_at");

CREATE INDEX "zone_checks_city_id_zone_key_idx" ON "public"."zone_checks"("city_id", "zone_key");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
