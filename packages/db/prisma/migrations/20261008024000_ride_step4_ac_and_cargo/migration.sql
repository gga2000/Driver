-- Taxi/tuktuk step 4, ride ideas x1 and x5. Additive only.
--
-- x5 «عندي غراض»: what the rider carries on his ride (bags, a gas cylinder, something big), shown to the
-- driver on the offer and the trip; never a price or dispatch input.
-- x1 «المكيّفة شغالة اليوم؟»: a ride driver's answer for one shift about his car's AC (hot days) or
-- heating (cold days). A «لا» takes the confirmed tag off until the shift ends, so riders don't see it
-- and the first waves of a hot day's car ride (AC cars only) skip him.

-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN     "ride_cargo" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "public"."orders"
    ADD CONSTRAINT "orders_ride_cargo_check" CHECK ("ride_cargo" <@ ARRAY['bags', 'gas', 'big']::TEXT[]);

-- CreateTable
CREATE TABLE "public"."driver_shift_checks" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "working" BOOLEAN NOT NULL,
    "answered_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_shift_checks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "driver_shift_checks_feature_check" CHECK ("feature" IN ('ac', 'heating'))
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_shift_checks_driver_id_shift_id_feature_key" ON "public"."driver_shift_checks"("driver_id", "shift_id", "feature");

-- CreateIndex
CREATE INDEX "driver_shift_checks_shift_id_working_idx" ON "public"."driver_shift_checks"("shift_id", "working");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
