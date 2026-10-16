-- vault_accessor_fk (CRIT2-01, LOAD-02, CRIT2-02, CRIT2-03): who read the vault is not always a person.
-- The system ("system:notify", "system:safety", "system:khat"…), a share-trip link ("share:<id>") and an
-- SOS link ("sos_link:<id>") read names and numbers too, and their ids broke the accessor's foreign key
-- to people on every such read (SOS, share page, vault-reading SMS/WhatsApp, the خطوط desk pager).
--
-- A read now names its reader by kind: 'person' (accessor_id, still a foreign key to people) or a
-- synthetic reader ('system', 'share_link', 'sos_link', …) whose id goes to accessor_ref with
-- accessor_id null. Additive only: the table is append-only (vault_access_logs_append_only →
-- reject_mutation), so there is no backfill UPDATE and older rows keep the default 'person'.
ALTER TABLE "identity_vault"."vault_access_logs" ADD COLUMN "accessor_kind" TEXT NOT NULL DEFAULT 'person';
ALTER TABLE "identity_vault"."vault_access_logs" ADD COLUMN "accessor_ref" TEXT;
ALTER TABLE "identity_vault"."vault_access_logs" ALTER COLUMN "accessor_id" DROP NOT NULL;

-- A person read names the person; any other read names its synthetic reader instead.
ALTER TABLE "identity_vault"."vault_access_logs" ADD CONSTRAINT "vault_access_logs_accessor_shape"
  CHECK (("accessor_kind" = 'person' AND "accessor_id" IS NOT NULL) OR ("accessor_kind" <> 'person' AND "accessor_id" IS NULL AND "accessor_ref" IS NOT NULL));

CREATE INDEX "vault_access_logs_accessor_ref_created_at_idx" ON "identity_vault"."vault_access_logs"("accessor_ref", "created_at");
