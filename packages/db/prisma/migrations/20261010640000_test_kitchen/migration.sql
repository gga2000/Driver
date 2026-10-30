-- Store-review test kitchen (launch plan W5, BENCH-04, decision D-4): a hidden kitchen only the
-- store-reviewer account sees, and the orders placed there.
ALTER TABLE "public"."orgs" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."orders" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
