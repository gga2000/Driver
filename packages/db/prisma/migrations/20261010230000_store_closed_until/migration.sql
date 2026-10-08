-- Counter redesign step 5 (h2): a store closed from the Merchant app can reopen by itself — the quick
-- pauses «الكهرباء طفت · 20 دقيقة» and «خلص الأكل · لباچر». Past this time the store reads as open
-- (like busy_until); NULL keeps today's meaning: closed until someone reopens it. Additive only.
ALTER TABLE "public"."orgs" ADD COLUMN "closed_until" TIMESTAMP(3);
