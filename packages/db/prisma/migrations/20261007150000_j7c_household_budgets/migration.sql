-- Joy w4, the family hub «بيتنا»: a monthly budget per household member, the reason an order asks the
-- payer, a withdrawn state for requests whose order went away, and the held / family-table flags on
-- orders. Additive only (no new tables); NULL / false = as before.

ALTER TYPE "public"."PayerApprovalState" ADD VALUE IF NOT EXISTS 'withdrawn';

ALTER TABLE "public"."org_members" ADD COLUMN "monthly_budget_iqd" INTEGER;

ALTER TABLE "public"."payer_approvals" ADD COLUMN "reason" TEXT;

ALTER TABLE "public"."orders" ADD COLUMN "held_for_payer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "family_table" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "orders_household_org_id_placed_at_idx" ON "public"."orders"("household_org_id", "placed_at");
