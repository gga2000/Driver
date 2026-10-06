-- Joy w9, the safety page: up to three trusted people (the first is the emergency contact) and the
-- safety switches, on the vault row next to the emergency contact. Additive only; NULL = never set.

ALTER TABLE "identity_vault"."person_identities" ADD COLUMN "trusted_contacts" JSONB;
ALTER TABLE "identity_vault"."person_identities" ADD COLUMN "safety_prefs" JSONB;
