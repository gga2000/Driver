-- Rate the courier (customer app §4 two-tap rating, step 1; before-launch §6). Additive only.
--
-- One row per order: the score (1–5) and one-tap reasons the customer gave the courier/driver who
-- carried it, written by `orders.rate` in the same transaction as the order's rating, within 24 h of
-- the order reaching him. Ids only (names stay in the vault). The driver scorecard and the average on
-- the courier card read a driver's newest rows (`driver_id`, `rated_at`). No foreign keys: orders and
-- trips belong to their modules.

CREATE TABLE "public"."courier_ratings" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_ratings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_ratings_order_id_key" ON "public"."courier_ratings"("order_id");

CREATE INDEX "courier_ratings_driver_id_rated_at_idx" ON "public"."courier_ratings"("driver_id", "rated_at");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
