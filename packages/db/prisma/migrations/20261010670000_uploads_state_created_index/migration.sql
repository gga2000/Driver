-- SEC-24: the sweep of upload tickets never uploaded reads pending rows oldest first.
-- CONCURRENTLY so the build never blocks upload writes of a running API; it is the only statement
-- here, so Prisma runs it outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "uploads_state_created_at_idx" ON "public"."uploads"("state", "created_at");
