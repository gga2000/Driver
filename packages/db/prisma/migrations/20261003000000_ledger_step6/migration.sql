-- M2 Step 6 (ledger): additive enum values for the posting-group lines.
-- service_fee / delivery_fee / fare name the charge lines of an order or ride; driver_incentive covers
-- shift-guarantee top-ups and rebroadcast compensation (edge-case G-91, decisions §6); driver_payout is
-- platform → driver when the platform owes the driver (G-86); rounding_residue posts customer-total
-- rounding to the `rounding` account (G-88); referral_bonus is the 200-point referral (decisions §1).
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'service_fee';
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'delivery_fee';
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'fare';
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'driver_incentive';
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'driver_payout';
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'rounding_residue';
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'referral_bonus';
