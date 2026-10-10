-- Event-history reads join every event to its outbox row (`outbox.event_id = events.id`): without
-- this index each read scanned the whole outbox. CONCURRENTLY so the build never blocks the outbox
-- writes of a running API; it is the only statement here, so Prisma runs it outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_event_id_idx" ON "public"."outbox"("event_id");
