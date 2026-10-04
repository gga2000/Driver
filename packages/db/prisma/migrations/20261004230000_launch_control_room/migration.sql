-- Launch-week control room (launch playbook §3 controls, §6 metrics; notifications & support §2):
-- kill switches per vertical / zone / restaurant / الرجعة corridor, the per-zone capacity throttle,
-- the status banner every open app shows, the console audit log, and support tickets moved out of
-- memory into Postgres. Review columns for the approvals queue on landmark photos, merchant
-- onboarding drafts and fleet vehicles. Additive only; existing vehicles stay "verified".

ALTER TABLE "public"."vehicles" ADD COLUMN "review_state" TEXT NOT NULL DEFAULT 'verified',
ADD COLUMN "reviewed_by_id" TEXT,
ADD COLUMN "reviewed_at" TIMESTAMP(3),
ADD COLUMN "review_note" TEXT;

ALTER TABLE "public"."landmark_photos" ADD COLUMN "reject_reason" TEXT;

ALTER TABLE "public"."merchant_onboardings" ADD COLUMN "reviewed_by_id" TEXT,
ADD COLUMN "reviewed_at" TIMESTAMP(3),
ADD COLUMN "reject_reason" TEXT;

CREATE TABLE "public"."ops_kill_switches" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "vertical" TEXT,
    "target" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hold_dispatch" BOOLEAN NOT NULL DEFAULT false,
    "message_ar" TEXT,
    "reason" TEXT NOT NULL,
    "set_by_id" TEXT NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_kill_switches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ops_zone_capacities" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "zone_key" TEXT NOT NULL,
    "max_active" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'refuse',
    "eta_min" INTEGER NOT NULL DEFAULT 15,
    "set_by_id" TEXT NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_zone_capacities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."system_banners" (
    "id" TEXT NOT NULL,
    "city_id" TEXT,
    "severity" TEXT NOT NULL,
    "audiences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "message_ar" TEXT NOT NULL,
    "message_en" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "set_by_id" TEXT NOT NULL,
    "cleared_at" TIMESTAMP(3),
    "cleared_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_banners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."console_audit_log" (
    "id" TEXT NOT NULL,
    "city_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "summary_ar" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "console_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."support_tickets" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "order_id" TEXT,
    "trip_id" TEXT,
    "customer_id" TEXT,
    "opened_by_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "first_response_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "sla_due_at" TIMESTAMP(3) NOT NULL,
    "assignee_id" TEXT,
    "fault_party" TEXT NOT NULL DEFAULT 'none',
    "refunded_iqd" INTEGER NOT NULL DEFAULT 0,
    "escalated_to" TEXT,
    "escalated_at" TIMESTAMP(3),
    "resolution" TEXT,
    "source_key" TEXT,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."support_ticket_entries" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "amount_iqd" INTEGER,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_ticket_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ops_kill_switches_city_id_target_key" ON "public"."ops_kill_switches"("city_id", "target");
CREATE INDEX "ops_kill_switches_city_id_active_idx" ON "public"."ops_kill_switches"("city_id", "active");
CREATE UNIQUE INDEX "ops_zone_capacities_city_id_zone_key_key" ON "public"."ops_zone_capacities"("city_id", "zone_key");
CREATE INDEX "system_banners_expires_at_idx" ON "public"."system_banners"("expires_at");
CREATE INDEX "console_audit_log_at_idx" ON "public"."console_audit_log"("at");
CREATE INDEX "console_audit_log_subject_kind_at_idx" ON "public"."console_audit_log"("subject_kind", "at");
CREATE UNIQUE INDEX "support_tickets_source_key_key" ON "public"."support_tickets"("source_key");
CREATE INDEX "support_tickets_status_opened_at_idx" ON "public"."support_tickets"("status", "opened_at");
CREATE INDEX "support_tickets_order_id_idx" ON "public"."support_tickets"("order_id");
CREATE INDEX "support_tickets_customer_id_opened_at_idx" ON "public"."support_tickets"("customer_id", "opened_at");
CREATE UNIQUE INDEX "support_ticket_entries_idempotency_key_key" ON "public"."support_ticket_entries"("idempotency_key");
CREATE INDEX "support_ticket_entries_ticket_id_at_idx" ON "public"."support_ticket_entries"("ticket_id", "at");
CREATE INDEX "support_ticket_entries_actor_id_kind_at_idx" ON "public"."support_ticket_entries"("actor_id", "kind", "at");

ALTER TABLE "public"."support_ticket_entries" ADD CONSTRAINT "support_ticket_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
