-- Customer waves (W5, D-24): who is let in to order, per zone, and how many each zone lets in.
-- Ids and zone keys only (no personal data). Additive only; no wave row = the zone is open.

-- CreateTable
CREATE TABLE "public"."customer_access" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "zone_key" TEXT,
    "state" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL,
    "admitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_access_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_access_state_check" CHECK ("state" IN ('waiting', 'admitted')),
    CONSTRAINT "customer_access_reason_check" CHECK ("reason" IN ('open', 'wave', 'existing', 'staff')),
    CONSTRAINT "customer_access_admitted_check" CHECK (("state" = 'admitted') = ("admitted_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "public"."ops_zone_waves" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "zone_key" TEXT NOT NULL,
    "open_slots" INTEGER,
    "set_by_id" TEXT NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_zone_waves_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ops_zone_waves_open_slots_check" CHECK ("open_slots" IS NULL OR "open_slots" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_access_person_id_key" ON "public"."customer_access"("person_id");

-- CreateIndex
CREATE INDEX "customer_access_city_id_zone_key_state_joined_at_idx" ON "public"."customer_access"("city_id", "zone_key", "state", "joined_at");

-- CreateIndex
CREATE UNIQUE INDEX "ops_zone_waves_city_id_zone_key_key" ON "public"."ops_zone_waves"("city_id", "zone_key");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
