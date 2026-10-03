-- Merchant deals at checkout and cash wallet top-up (docs/api/deals-and-topup.md). Additive only.
-- orders.discount_meta: the discount line behind discount_iqd (funder, target, type, labels).
-- wallet_topups: customer top-up codes confirmed by an ops agent or the courier on the next order.

ALTER TABLE "public"."orders" ADD COLUMN "discount_meta" JSONB;

CREATE TABLE "public"."wallet_topups" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "channel" TEXT,
    "reference" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_topups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_topups_reference_key" ON "public"."wallet_topups"("reference");
CREATE UNIQUE INDEX "wallet_topups_idempotency_key_key" ON "public"."wallet_topups"("idempotency_key");
CREATE INDEX "wallet_topups_code_state_idx" ON "public"."wallet_topups"("code", "state");
CREATE INDEX "wallet_topups_customer_id_created_at_idx" ON "public"."wallet_topups"("customer_id", "created_at");
