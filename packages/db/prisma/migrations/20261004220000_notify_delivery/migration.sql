-- Notification delivery (domain §8, notify module): push tokens tied to sessions, per-person
-- notification switches, and the delivery log (one row per message, channel and person; the unique
-- dedupe key makes an outbox redelivery a no-op). Additive only; no foreign keys into other modules'
-- tables (persons, sessions and orders are referenced by id).

CREATE TABLE "public"."push_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "session_id" TEXT,
    "app" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."notify_preferences" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "order_updates" BOOLEAN NOT NULL DEFAULT true,
    "chat" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_receipts" BOOLEAN NOT NULL DEFAULT true,
    "sms_fallback" BOOLEAN NOT NULL DEFAULT true,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notify_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."notify_deliveries" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "order_id" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "provider" TEXT,
    "provider_ref" TEXT,
    "tickets" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "twin" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "not_before" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notify_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_tokens_token_key" ON "public"."push_tokens"("token");
CREATE INDEX "push_tokens_person_id_app_idx" ON "public"."push_tokens"("person_id", "app");
CREATE INDEX "push_tokens_session_id_idx" ON "public"."push_tokens"("session_id");

CREATE UNIQUE INDEX "notify_preferences_person_id_key" ON "public"."notify_preferences"("person_id");

CREATE UNIQUE INDEX "notify_deliveries_dedupe_key_channel_key" ON "public"."notify_deliveries"("dedupe_key", "channel");
CREATE INDEX "notify_deliveries_person_id_created_at_idx" ON "public"."notify_deliveries"("person_id", "created_at");
CREATE INDEX "notify_deliveries_order_id_created_at_idx" ON "public"."notify_deliveries"("order_id", "created_at");
CREATE INDEX "notify_deliveries_provider_ref_idx" ON "public"."notify_deliveries"("provider_ref");
