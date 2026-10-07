-- Taxi/tuktuk step 4 (c10 + o4). Additive only.
--
-- «نفس مشوار البارحة؟» (o4): every ride a rider books leaves a footprint (where from and to, how, and
-- the time he wanted it: the booked time of a ride for later, else when he asked). A ride he took on 3
-- of the last 4 working days at about the same time gets one gentle push 10 minutes before it, with its
-- own switch (`notify_preferences.same_ride`, on by default). Ids and points only; no names.

ALTER TABLE "public"."notify_preferences" ADD COLUMN     "same_ride" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "public"."ride_footprints" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "door_pickup" BOOLEAN NOT NULL DEFAULT false,
    "pickup" JSONB NOT NULL,
    "dropoff" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "minute_of_day" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_footprints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ride_footprints_order_id_key" ON "public"."ride_footprints"("order_id");

CREATE INDEX "ride_footprints_minute_of_day_at_idx" ON "public"."ride_footprints"("minute_of_day", "at");

CREATE INDEX "ride_footprints_person_id_at_idx" ON "public"."ride_footprints"("person_id", "at");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
