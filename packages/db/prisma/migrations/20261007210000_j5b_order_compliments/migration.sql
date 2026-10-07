-- Compliments after a good rating (customer joy J5b, l4): the kind words a customer picked for the
-- courier or driver who carried one order — keys only, never free text, never money. One row per
-- order; the courier reads them in the Partner app. Additive only.

-- CreateTable
CREATE TABLE "public"."order_compliments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "keys" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_compliments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_compliments_courier_id_created_at_idx" ON "public"."order_compliments"("courier_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_compliments_order_id_key" ON "public"."order_compliments"("order_id");

-- Supabase lock-down for the new table (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
