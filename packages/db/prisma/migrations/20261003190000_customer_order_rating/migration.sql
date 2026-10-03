-- Customer live screen (customer app spec §4): the two-tap rating, delivery and food scored
-- separately, stored with the order as {delivery, food, tags[], note, ratedAt}. Additive and
-- nullable: orders rated before it keep only rated_at.
ALTER TABLE "public"."orders" ADD COLUMN "rating" JSONB;
