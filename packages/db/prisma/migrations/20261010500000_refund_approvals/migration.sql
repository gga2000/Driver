-- Refunds over a limit wait for a second staff member's OK (Ali 2026-10-08, Console item 4). Ids and
-- amounts only. Additive only.

-- CreateTable
CREATE TABLE "public"."refund_approvals" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "order_id" TEXT,
    "amount_iqd" INTEGER NOT NULL,
    "limit_kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decline_note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_approvals_idempotency_key_key" ON "public"."refund_approvals"("idempotency_key");

-- CreateIndex
CREATE INDEX "refund_approvals_state_requested_at_idx" ON "public"."refund_approvals"("state", "requested_at");

-- CreateIndex
CREATE INDEX "refund_approvals_ticket_id_idx" ON "public"."refund_approvals"("ticket_id");

-- CreateIndex
CREATE INDEX "refund_approvals_order_id_idx" ON "public"."refund_approvals"("order_id");

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
