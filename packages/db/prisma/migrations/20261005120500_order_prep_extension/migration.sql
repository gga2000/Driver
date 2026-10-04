-- One-tap accept with "+5 د" (UI/UX audit M-12, approved by Ali 2026-10-04): after accepting, the
-- kitchen may push its promised ready time by 5 minutes once per order. This column records when it
-- did, so a second extension is refused. Additive and nullable: existing orders were never extended.
ALTER TABLE "public"."orders" ADD COLUMN "prep_extended_at" TIMESTAMP(3);
