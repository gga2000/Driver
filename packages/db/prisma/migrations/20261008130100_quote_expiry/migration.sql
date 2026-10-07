-- LOAD-01: `pricing.quote` now keeps the quote it hands out. orders.quote_id and trips.quote_id are
-- foreign keys to quotes and nothing wrote quotes, so every ride booked with a quote failed. A quote is
-- good until expires_at, and one order may take it (orders.quote_id is unique). Additive only.
ALTER TABLE "public"."quotes" ADD COLUMN "expires_at" TIMESTAMP(3);
