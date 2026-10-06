-- Food habits (customer joy J7a, h2): «قدر اليوم» — one dish of the day per kitchen and Baghdad date —
-- and dish follows («خبرني لمن يطبخوه»: the person is told, once a day at most, when a dish they follow
-- is a kitchen's pot), with its own notification switch (on by default; following is the opt-in).
-- The kitchen story (h5) lives in the storefront JSON on catalogs. Additive only.

-- AlterTable
ALTER TABLE "public"."notify_preferences" ADD COLUMN     "dish_pots" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "public"."daily_pots" (
    "id" TEXT NOT NULL,
    "merchant_org_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "note" TEXT,
    "until" TEXT,
    "posted_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_pots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dish_follows" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "merchant_org_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dish_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_pots_local_date_idx" ON "public"."daily_pots"("local_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_pots_merchant_org_id_local_date_key" ON "public"."daily_pots"("merchant_org_id", "local_date");

-- CreateIndex
CREATE INDEX "dish_follows_item_id_idx" ON "public"."dish_follows"("item_id");

-- CreateIndex
CREATE INDEX "dish_follows_merchant_org_id_idx" ON "public"."dish_follows"("merchant_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "dish_follows_person_id_item_id_key" ON "public"."dish_follows"("person_id", "item_id");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
