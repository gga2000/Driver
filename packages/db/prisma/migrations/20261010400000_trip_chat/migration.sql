-- Private car round 2 step 4c (Ali's item 11, 2026-10-08): Baghdad/Kut chat between a rider and the
-- driver of a run or a private-car offer, one thread per pair, with the agreed-price cards.
-- A `rider_driver` thread is keyed by its run or request (order_id) and the other side (party_id);
-- order threads keep party_id ''. Card messages name what they are about and the amount they carried.

ALTER TABLE "public"."chat_threads" ADD COLUMN "party_id" TEXT NOT NULL DEFAULT '';

DROP INDEX "public"."chat_threads_order_id_kind_key";
CREATE UNIQUE INDEX "chat_threads_order_id_kind_party_id_key" ON "public"."chat_threads"("order_id", "kind", "party_id");

ALTER TABLE "public"."chat_messages" ADD COLUMN "ref_kind" TEXT,
ADD COLUMN "ref_id" TEXT,
ADD COLUMN "ref_amount_iqd" INTEGER;

ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_ref_check"
  CHECK (("ref_kind" IS NULL AND "ref_id" IS NULL AND "ref_amount_iqd" IS NULL)
      OR ("ref_kind" IN ('pin_pickup', 'door_drop', 'cash_reservation') AND "ref_id" IS NOT NULL AND ("ref_amount_iqd" IS NULL OR "ref_amount_iqd" >= 0)));
