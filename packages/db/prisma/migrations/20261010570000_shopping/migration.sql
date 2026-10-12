-- The shopping side «السوق» (2026-10-11): produce stalls and bakeries are grocer orgs with a storefront
-- tagged `shop`. `shop_items` says how each catalog item sells (by the kilo, the piece or a bakery lot,
-- with the pieces-per-kilo hint); `shop_day_posts` is a stall's morning «أسعار اليوم» (price, photo,
-- «نفس البارحة») per item and local day; `shop_daily_bread` holds «صمون كل يوم» standing orders.
-- A weighed order line keeps its grams and the kilo price it was sold at; a دوّرلي line keeps the
-- shopper's item card. No names or phones here. Additive only.

CREATE TABLE "public"."shop_items" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "sold_by" TEXT NOT NULL,
    "pieces_min" INTEGER,
    "pieces_max" INTEGER,
    "pieces_word" TEXT,
    "per_lot" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."shop_day_posts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "price_iqd" INTEGER NOT NULL,
    "photo_url" TEXT,
    "from_yesterday" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_day_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."shop_daily_bread" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "packs" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "days" INTEGER[],
    "dropoff" JSONB NOT NULL,
    "courier_note" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "last_placed_on" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_daily_bread_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "public"."order_lines" ADD COLUMN "weight_g" INTEGER,
ADD COLUMN "per_kg_iqd" INTEGER,
ADD COLUMN "errand_item" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "shop_items_item_id_key" ON "public"."shop_items"("item_id");

-- CreateIndex
CREATE INDEX "shop_items_org_id_idx" ON "public"."shop_items"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_day_posts_item_id_local_date_key" ON "public"."shop_day_posts"("item_id", "local_date");

-- CreateIndex
CREATE INDEX "shop_day_posts_org_id_local_date_idx" ON "public"."shop_day_posts"("org_id", "local_date");

-- CreateIndex
CREATE INDEX "shop_daily_bread_person_id_idx" ON "public"."shop_daily_bread"("person_id");

-- CreateIndex
CREATE INDEX "shop_daily_bread_time_paused_idx" ON "public"."shop_daily_bread"("time", "paused");

-- CreateIndex
CREATE INDEX "shop_daily_bread_org_id_idx" ON "public"."shop_daily_bread"("org_id");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
