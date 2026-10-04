-- M2 review follow-up: a khat child's name leaves the public schema (domain §13 identity vault).
--
-- Stops and khat.child_tapped_* events carry only an opaque childRef (= vault.child_identities.id);
-- the name is read through the identity module for the driver's run sheet and the guardian's view,
-- every read logged in vault.vault_access_logs (child_ref says which child).
--
-- Expand, move, then drop: the new table and columns are added, any name already on a stop is moved
-- into the vault (one identity per subscription order and name, so a child's pickup and drop-off
-- share one ref), and only then is stops.child_name dropped, so no name is lost and none stays public.

-- 1. The vault side.
CREATE TABLE "identity_vault"."child_identities" (
    "id" TEXT NOT NULL,
    "guardian_id" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "child_identities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "child_identities_guardian_id_idx" ON "identity_vault"."child_identities"("guardian_id");
ALTER TABLE "identity_vault"."child_identities" ADD CONSTRAINT "child_identities_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER "child_identities_set_updated_at" BEFORE UPDATE ON "identity_vault"."child_identities" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

ALTER TABLE "identity_vault"."vault_access_logs" ADD COLUMN "child_ref" TEXT;

-- 2. The public side: an opaque reference only.
ALTER TABLE "public"."stops" ADD COLUMN "child_ref" TEXT;

-- 3. Move names already on stops into the vault (guardian unknown for these rows: NULL).
INSERT INTO "identity_vault"."child_identities" ("id", "guardian_id", "name", "created_at", "updated_at")
SELECT DISTINCT 'chm_' || md5(coalesce("order_id", "trip_id") || ':' || "child_name"), NULL, "child_name", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."stops"
WHERE "child_name" IS NOT NULL;

UPDATE "public"."stops"
SET "child_ref" = 'chm_' || md5(coalesce("order_id", "trip_id") || ':' || "child_name")
WHERE "child_name" IS NOT NULL;

-- 4. Past khat.child_tapped_* events (and their outbox rows) carried the name: swap it for the ref.
UPDATE "public"."events" e
SET "payload" = (e."payload" - 'childName') || jsonb_build_object('childRef', s."child_ref")
FROM "public"."stops" s
WHERE e."type" IN ('khat.child_tapped_in', 'khat.child_tapped_out') AND e."payload" ? 'childName' AND s."id" = e."payload"->>'stopId';

UPDATE "public"."outbox" o
SET "payload" = (o."payload" - 'childName') || jsonb_build_object('childRef', s."child_ref")
FROM "public"."stops" s
WHERE o."type" IN ('khat.child_tapped_in', 'khat.child_tapped_out') AND o."payload" ? 'childName' AND s."id" = o."payload"->>'stopId';

-- Anything left (a stop that no longer exists) loses the name without a ref.
UPDATE "public"."events" SET "payload" = "payload" - 'childName' WHERE "type" IN ('khat.child_tapped_in', 'khat.child_tapped_out') AND "payload" ? 'childName';
UPDATE "public"."outbox" SET "payload" = "payload" - 'childName' WHERE "type" IN ('khat.child_tapped_in', 'khat.child_tapped_out') AND "payload" ? 'childName';

-- 5. No child name in the public schema any more.
ALTER TABLE "public"."stops" DROP COLUMN "child_name";
