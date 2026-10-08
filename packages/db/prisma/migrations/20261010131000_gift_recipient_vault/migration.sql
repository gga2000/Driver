-- SEC-14: the name a sender gave the person who receives his order (a gift «عزيمة», or food sent to
-- someone else) moves out of public.participants into the vault, next to the riders' names
-- (identity_vault.participant_identities, keyed by the participant id). No new table.
--
-- The vault row's person is the recipient when they have an account, otherwise the orderer who named
-- them; given_by is always the orderer. Every read goes through IdentityService.participantNames
-- (logged). participants is not append-only: the public label is cleared in the same migration.

INSERT INTO "identity_vault"."participant_identities" ("id", "participant_id", "person_id", "given_by_id", "name", "created_at", "updated_at")
SELECT 'pi_' || replace(gen_random_uuid()::text, '-', ''), p."id", COALESCE(p."person_id", o."orderer_id"), o."orderer_id", left(btrim(p."label"), 40), p."created_at", now()
FROM "public"."participants" p
JOIN "public"."orders" o ON o."id" = p."order_id"
WHERE p."role" = 'recipient' AND p."label" IS NOT NULL AND btrim(p."label") <> ''
ON CONFLICT ("participant_id") DO NOTHING;

UPDATE "public"."participants" SET "label" = NULL WHERE "role" = 'recipient' AND "label" IS NOT NULL;
