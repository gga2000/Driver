-- Orgs, places and uploads leave memory (docs/persistence.md): merchant settings become columns on
-- `orgs` (busy mode, early close, printer, prep time, commission tier, kitchen location as PostGIS
-- geography), household payer approvals get a table, customers' saved places reuse `places` (label,
-- zone, photo refs, confirmation, household sharing, client ref), and photo upload records get
-- `uploads` (bytes stay in object storage). Additive, except `orgs.pause_windows`, which becomes
-- nullable with no default: NULL now means "the city's seeded windows", and existing rows keep theirs.
-- No names or phones here: people are ids, their identifiers stay in vault.person_identities.

-- ───────────── enums ─────────────
CREATE TYPE "public"."PayerApprovalState" AS ENUM ('pending', 'approved', 'declined');

-- ───────────── orgs: merchant settings ─────────────
ALTER TABLE "public"."orgs" ALTER COLUMN "pause_windows" DROP NOT NULL,
ALTER COLUMN "pause_windows" DROP DEFAULT,
ADD COLUMN "busy_until" TIMESTAMP(3),
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "closed_reason" TEXT,
ADD COLUMN "closed_note" TEXT,
ADD COLUMN "printer_state" TEXT,
ADD COLUMN "printer_name" TEXT,
ADD COLUMN "printer_at" TIMESTAMP(3),
ADD COLUMN "default_prep_min" INTEGER,
ADD COLUMN "commission_tier" TEXT,
ADD COLUMN "location_zone_key" TEXT,
ADD COLUMN "location_pin" geography(Point, 4326);

-- ───────────── places: customers' saved places ─────────────
ALTER TABLE "public"."places" ADD COLUMN "label" TEXT,
ADD COLUMN "zone_key" TEXT,
ADD COLUMN "photo_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "confirmed_at" TIMESTAMP(3),
ADD COLUMN "share_with_household" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "client_ref" TEXT;

-- ───────────── tables ─────────────
CREATE TABLE "public"."payer_approvals" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "state" "public"."PayerApprovalState" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."uploads" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "max_bytes" INTEGER NOT NULL,
    "size_bytes" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "storage_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- ───────────── indexes ─────────────
CREATE INDEX "orgs_location_pin_idx" ON "public"."orgs" USING GIST ("location_pin");
CREATE UNIQUE INDEX "places_owner_id_client_ref_key" ON "public"."places"("owner_id", "client_ref");
CREATE UNIQUE INDEX "payer_approvals_org_id_order_id_key" ON "public"."payer_approvals"("org_id", "order_id");
CREATE INDEX "payer_approvals_org_id_state_idx" ON "public"."payer_approvals"("org_id", "state");
CREATE INDEX "uploads_owner_id_idx" ON "public"."uploads"("owner_id");

-- ───────────── foreign keys ─────────────
ALTER TABLE "public"."payer_approvals" ADD CONSTRAINT "payer_approvals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
