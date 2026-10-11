-- Food carts «عربانات» (2026-10-11): a cart is a restaurant org that moves. `food_carts` holds where it
-- opened tonight, its usual hours and away note; `food_cart_follows` the customers who hear «فتح»;
-- `food_cart_walkups` the walk-over tickets (3-digit code, cash at the cart, the restaurants' pickup
-- commission tier recorded on collection). No names or phones here. Additive only.

CREATE TABLE "public"."food_carts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "spot_lat" DOUBLE PRECISION,
    "spot_lng" DOUBLE PRECISION,
    "spot_label" TEXT,
    "facing" INTEGER NOT NULL DEFAULT 180,
    "opened_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "usual_from" TEXT,
    "usual_to" TEXT,
    "away_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_carts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."food_cart_follows" (
    "person_id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_cart_follows_pkey" PRIMARY KEY ("person_id","cart_id")
);

CREATE TABLE "public"."food_cart_walkups" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'placed',
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "total_iqd" INTEGER NOT NULL,
    "commission_iqd" INTEGER NOT NULL DEFAULT 0,
    "ready_by" TIMESTAMP(3) NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_cart_walkups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "food_carts_org_id_key" ON "public"."food_carts"("org_id");

CREATE INDEX "food_carts_city_id_idx" ON "public"."food_carts"("city_id");

CREATE INDEX "food_cart_follows_cart_id_idx" ON "public"."food_cart_follows"("cart_id");

CREATE INDEX "food_cart_walkups_cart_id_state_idx" ON "public"."food_cart_walkups"("cart_id", "state");

CREATE INDEX "food_cart_walkups_person_id_state_idx" ON "public"."food_cart_walkups"("person_id", "state");

-- «{cart} فتح» can be switched off in the customer's notification settings (on by default).
ALTER TABLE "public"."notify_preferences" ADD COLUMN     "food_carts" BOOLEAN NOT NULL DEFAULT true;

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
