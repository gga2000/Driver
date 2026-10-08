-- LOAD-01 follow-up (launch plan W4, retention): `pricing.quote` keeps every quote it hands out, so a
-- worker deletes the ones nobody booked an hour after `expires_at` (QuoteRetention). This index lets that
-- sweep find them without reading the whole table. Additive only.

-- CreateIndex
CREATE INDEX "quotes_expires_at_idx" ON "public"."quotes"("expires_at");
