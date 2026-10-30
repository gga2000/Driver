-- M-3 «ينضاف لطلبك الجاي»: the cancellation fees a cash customer owed, locked on the order at
-- placement and collected in cash with it (behind CASH_DEBT_COLLECT, off by default).
ALTER TABLE "public"."orders" ADD COLUMN "debt_collect_iqd" INTEGER NOT NULL DEFAULT 0;
