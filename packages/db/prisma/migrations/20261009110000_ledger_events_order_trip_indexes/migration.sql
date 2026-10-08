-- An order's or a trip's money lines (receipts, disputes, the Console) are read by order_id / trip_id;
-- without these indexes each read scans the whole ledger. Additive only. The table is small before
-- launch, so a plain CREATE INDEX holds its write lock for well under a second; give up rather than
-- queue behind a long transaction.
SET lock_timeout = '3s';

-- CreateIndex
CREATE INDEX "ledger_events_order_id_occurred_at_idx" ON "public"."ledger_events"("order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_events_trip_id_occurred_at_idx" ON "public"."ledger_events"("trip_id", "occurred_at");

RESET lock_timeout;
