-- Joy J7d (docs/superpowers/plans/2026-10-07-j7d-ride-habits.md). Additive only.
--
-- «سايقي المفضل» (l9): a rider's favourite drivers (ids only; first names and approved photos are read
-- from the vault, logged). A ride booked for later may ask for one (`orders.preferred_driver_id`): he
-- gets the job alone for a minute when the search starts, then dispatch carries on as always.
--
-- Regular trips (r5): a weekly ride or الرجعة, asked about the evening before or that morning, booked
-- only on «أكدها»; each day's decision is one row (unique per trip and Baghdad date). The reminder has its
-- own switch (`notify_preferences.regular_trips`, on by default: saving the trip is the opt-in).

ALTER TABLE "public"."orders" ADD COLUMN     "preferred_driver_id" TEXT;

ALTER TABLE "public"."notify_preferences" ADD COLUMN     "regular_trips" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "public"."favourite_drivers" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "favourite_drivers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."regular_trips" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "days" INTEGER[],
    "time_min" INTEGER NOT NULL,
    "remind" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'cash',
    "favourite_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "plan" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regular_trips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."regular_trip_occurrences" (
    "id" TEXT NOT NULL,
    "regular_trip_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "order_id" TEXT,
    "booking_id" TEXT,
    "demand_id" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regular_trip_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "favourite_drivers_driver_id_idx" ON "public"."favourite_drivers"("driver_id");

CREATE UNIQUE INDEX "favourite_drivers_person_id_driver_id_key" ON "public"."favourite_drivers"("person_id", "driver_id");

CREATE INDEX "regular_trips_person_id_idx" ON "public"."regular_trips"("person_id");

CREATE INDEX "regular_trips_active_idx" ON "public"."regular_trips"("active");

CREATE UNIQUE INDEX "regular_trip_occurrences_regular_trip_id_date_key" ON "public"."regular_trip_occurrences"("regular_trip_id", "date");

ALTER TABLE "public"."regular_trips" ADD CONSTRAINT "regular_trips_favourite_id_fkey" FOREIGN KEY ("favourite_id") REFERENCES "public"."favourite_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."regular_trip_occurrences" ADD CONSTRAINT "regular_trip_occurrences_regular_trip_id_fkey" FOREIGN KEY ("regular_trip_id") REFERENCES "public"."regular_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
