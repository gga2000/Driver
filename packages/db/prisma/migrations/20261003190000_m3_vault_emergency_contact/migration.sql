-- M3 customer profile (customer spec §10 safety): the emergency contact is a third person's name and
-- phone, so it lives in the identity vault next to the customer's own (domain §13), read only through
-- the identity module. {name, phoneE164}; NULL = none set.
ALTER TABLE "identity_vault"."person_identities" ADD COLUMN "emergency_contact" JSONB;
