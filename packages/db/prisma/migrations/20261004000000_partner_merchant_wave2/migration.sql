-- Partner & Merchant apps, wave 2 (docs/api/partner-merchant-wave2.md): driver documents and daily
-- check-ins, خطوط absences, fleet drivers, field-ops photos / cash receipts / onboardings / tasks,
-- menu price history and photo imports, merchant dispute responses; "sold out today" on menu items
-- and the merchant-deal columns on promotions. Additive only. No foreign keys to `orgs` (orgs are
-- still in memory); document photos and selfies stay in the vault (person_identities.*_refs).

-- ───────────── enums ─────────────
CREATE TYPE "public"."DriverDocumentKind" AS ENUM ('national_id_front', 'national_id_back', 'licence', 'vehicle_registration', 'insurance', 'photo');
CREATE TYPE "public"."DriverDocumentStatus" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "public"."DriverCheckInResult" AS ENUM ('pending', 'passed', 'failed');

-- ───────────── existing tables ─────────────
ALTER TABLE "public"."catalog_items" ADD COLUMN "sold_out_until" TIMESTAMP(3);
ALTER TABLE "public"."promotions" ADD COLUMN "proposal_state" TEXT;
ALTER TABLE "public"."promotions" ADD COLUMN "projected_cost_iqd" INTEGER;

-- ───────────── tables ─────────────
CREATE TABLE "public"."driver_documents" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "kind" "public"."DriverDocumentKind" NOT NULL,
    "status" "public"."DriverDocumentStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reject_reason" TEXT,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."driver_check_ins" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "gesture" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "result" "public"."DriverCheckInResult" NOT NULL DEFAULT 'pending',
    "submitted_at" TIMESTAMP(3),
    "liveness_score" DOUBLE PRECISION,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_check_ins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."khat_absences" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "child_ref" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "reported_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "skipped_stop_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "khat_absences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."fleet_drivers" (
    "id" TEXT NOT NULL,
    "fleet_org_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "added_by_id" TEXT NOT NULL,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_drivers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."landmark_photos" (
    "id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "caption" TEXT,
    "local_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "state" TEXT NOT NULL DEFAULT 'proposed',
    "added_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landmark_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ops_cash_receipts" (
    "id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "note" TEXT,
    "courier_cash_after_iqd" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_cash_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."merchant_onboardings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contact_person_id" TEXT NOT NULL,
    "location" JSONB NOT NULL,
    "menu_photo_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "shop_photo_ref" TEXT,
    "notes" TEXT,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_onboardings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ops_tasks" (
    "id" TEXT NOT NULL,
    "city_id" TEXT,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "assignee_id" TEXT,
    "due_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."catalog_price_changes" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "old_price_iqd" INTEGER NOT NULL,
    "new_price_iqd" INTEGER NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_price_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."menu_import_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "photo_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "state" TEXT NOT NULL DEFAULT 'draft',
    "items" JSONB NOT NULL DEFAULT '[]',
    "ocr" TEXT NOT NULL DEFAULT 'stub',
    "created_by_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3),
    "applied_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."merchant_dispute_responses" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "merchant_org_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "responded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_dispute_responses_pkey" PRIMARY KEY ("id")
);

-- ───────────── indexes ─────────────
CREATE INDEX "driver_documents_person_id_kind_idx" ON "public"."driver_documents"("person_id", "kind");
CREATE INDEX "driver_documents_status_expires_at_idx" ON "public"."driver_documents"("status", "expires_at");
CREATE INDEX "driver_check_ins_person_id_local_date_idx" ON "public"."driver_check_ins"("person_id", "local_date");
CREATE INDEX "khat_absences_child_ref_local_date_idx" ON "public"."khat_absences"("child_ref", "local_date");
CREATE UNIQUE INDEX "khat_absences_trip_id_child_ref_key" ON "public"."khat_absences"("trip_id", "child_ref");
CREATE INDEX "fleet_drivers_person_id_idx" ON "public"."fleet_drivers"("person_id");
CREATE UNIQUE INDEX "fleet_drivers_fleet_org_id_person_id_key" ON "public"."fleet_drivers"("fleet_org_id", "person_id");
CREATE INDEX "landmark_photos_target_kind_target_id_idx" ON "public"."landmark_photos"("target_kind", "target_id");
CREATE INDEX "landmark_photos_state_created_at_idx" ON "public"."landmark_photos"("state", "created_at");
CREATE UNIQUE INDEX "ops_cash_receipts_reference_key" ON "public"."ops_cash_receipts"("reference");
CREATE UNIQUE INDEX "ops_cash_receipts_idempotency_key_key" ON "public"."ops_cash_receipts"("idempotency_key");
CREATE INDEX "ops_cash_receipts_courier_id_created_at_idx" ON "public"."ops_cash_receipts"("courier_id", "created_at");
CREATE INDEX "ops_cash_receipts_received_by_id_created_at_idx" ON "public"."ops_cash_receipts"("received_by_id", "created_at");
CREATE INDEX "merchant_onboardings_state_created_at_idx" ON "public"."merchant_onboardings"("state", "created_at");
CREATE INDEX "merchant_onboardings_created_by_id_idx" ON "public"."merchant_onboardings"("created_by_id");
CREATE INDEX "ops_tasks_state_assignee_id_idx" ON "public"."ops_tasks"("state", "assignee_id");
CREATE INDEX "catalog_price_changes_item_id_created_at_idx" ON "public"."catalog_price_changes"("item_id", "created_at");
CREATE INDEX "menu_import_jobs_org_id_created_at_idx" ON "public"."menu_import_jobs"("org_id", "created_at");
CREATE UNIQUE INDEX "merchant_dispute_responses_order_id_key" ON "public"."merchant_dispute_responses"("order_id");
CREATE INDEX "merchant_dispute_responses_merchant_org_id_idx" ON "public"."merchant_dispute_responses"("merchant_org_id");
