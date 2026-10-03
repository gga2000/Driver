-- Review 2026-10-04: EventsService.forAggregate (merchantAdmin.money.cash reads merchant/<id> on every open)
CREATE INDEX "events_aggregate_aggregate_id_occurred_at_idx" ON "public"."events"("aggregate", "aggregate_id", "occurred_at");
