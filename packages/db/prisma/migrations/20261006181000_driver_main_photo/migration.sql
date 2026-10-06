-- Driver photos (Ali, 2026-10-06): every driver has one approved main photo that customers see, and a
-- guardian may add a photo of a خطوط child that only the child's run driver sees. Both are storage refs
-- in the identity vault (domain §13); reads are logged in vault_access_logs. Additive only.

ALTER TABLE "identity_vault"."person_identities" ADD COLUMN "main_photo_at" TIMESTAMP(3),
ADD COLUMN "main_photo_ref" TEXT;

ALTER TABLE "identity_vault"."child_identities" ADD COLUMN "photo_ref" TEXT;

-- Drivers whose `photo` document was approved before this column existed: their current approved
-- photo becomes the main photo (the vault's document_refs entry for that document).
UPDATE "identity_vault"."person_identities" AS pi
SET "main_photo_ref" = x."ref", "main_photo_at" = x."reviewed_at"
FROM (
  SELECT DISTINCT ON (i."person_id") i."person_id", e.value ->> 'ref' AS "ref", d."reviewed_at"
  FROM "identity_vault"."person_identities" AS i
  JOIN "public"."driver_documents" AS d
    ON d."person_id" = i."person_id" AND d."kind" = 'photo' AND d."status" = 'approved' AND d."superseded_at" IS NULL
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i."document_refs") = 'array' THEN i."document_refs" ELSE '[]'::jsonb END) AS e(value)
  WHERE e.value ->> 'recordId' = d."id" AND e.value ->> 'ref' IS NOT NULL
  ORDER BY i."person_id", d."reviewed_at" DESC NULLS LAST
) AS x
WHERE pi."person_id" = x."person_id";

-- Supabase lock-down (no new table; re-applied so the vault stays closed to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
