-- Taxi/tuktuk step 3 (offered drivers, «نبّهه», «ما أريده مرة ثانية», «عوائل»). Additive only.
--
-- n4 «نبّهه»: the rider nudges a driver who was sent his ride (once per driver per ride); the time is
-- kept on the offer (`dispatch_offers.nudged_at`) and the driver gets a soft «راكب ينتظرك».
-- s5: drivers a rider never wants again (ids only; names and photos are read from the vault when shown).
-- Dispatch never offers that rider's rides to them.
-- s6: a ride placed with «عوائل» goes to family-tagged, long-standing, well-rated drivers first
-- (`orders.family_preferred`, carried over when the rider switches vehicle).
-- The vehicles' model, colour and features columns come with the vehicle details migration.

ALTER TABLE "public"."dispatch_offers" ADD COLUMN     "nudged_at" TIMESTAMP(3);

ALTER TABLE "public"."orders" ADD COLUMN     "family_preferred" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "public"."avoided_drivers" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avoided_drivers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "avoided_drivers_driver_id_idx" ON "public"."avoided_drivers"("driver_id");

CREATE UNIQUE INDEX "avoided_drivers_person_id_driver_id_key" ON "public"."avoided_drivers"("person_id", "driver_id");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
