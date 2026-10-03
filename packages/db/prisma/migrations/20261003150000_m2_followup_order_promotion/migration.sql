-- M2 review follow-up: an order's discount comes only from a server-resolved promotion.
-- Additive and nullable: no existing order has a promotion behind its discount (NULL).
ALTER TABLE "public"."orders" ADD COLUMN "promotion_id" TEXT;
