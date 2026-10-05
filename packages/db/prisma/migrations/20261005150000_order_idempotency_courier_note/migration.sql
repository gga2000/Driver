-- No duplicate orders (offline work): the customer app sends one idempotency key per checkout attempt
-- and re-sends it on every retry; a repeated key returns the order already placed. The unique index is
-- per orderer, so two simultaneous calls with one key can never both insert (NULL = no key sent; NULLs
-- never collide). M-09: the customer's note for the courier is kept apart from the kitchen note.
-- Additive and nullable: existing orders have neither. No new table, so no driver_harden call.
ALTER TABLE "public"."orders" ADD COLUMN "courier_note" TEXT,
ADD COLUMN "client_request_id" TEXT;

CREATE UNIQUE INDEX "orders_orderer_id_client_request_id_key" ON "public"."orders"("orderer_id", "client_request_id");
