-- N20 «شارع مسدود» (Ali, 2026-10-11): field ops close a street for today and every route goes around it.
-- Places, a reason and staff person ids only; no personal data. Additive only.

-- CreateTable
CREATE TABLE "public"."street_closures" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "path" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "name_ar" TEXT,
    "length_m" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "closed_by_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3),
    "opened_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "street_closures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "street_closures_reason_check" CHECK ("reason" IN ('works', 'funeral', 'water', 'other')),
    CONSTRAINT "street_closures_ends_after_start_check" CHECK ("ends_at" > "starts_at")
);

-- CreateIndex
CREATE INDEX "street_closures_city_id_ends_at_idx" ON "public"."street_closures"("city_id", "ends_at");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
