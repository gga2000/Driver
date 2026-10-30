-- The job machines count stuck sends every minute (`stuckClaims`: status queued/deferred, sent_at
-- older than 5 minutes). Without this index each count scanned every delivery row ever written.
-- CONCURRENTLY so the build never blocks the notify writes of a running API; it is the only statement
-- here, so Prisma runs it outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notify_deliveries_status_sent_at_idx" ON "public"."notify_deliveries"("status", "sent_at");
