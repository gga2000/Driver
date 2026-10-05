-- SOS (scoring & safety §3): the safety module's incidents, their timeline and the position trail of
-- the pressing phone. People, trips, orders, departures and requests are referenced by id (no foreign
-- keys across modules); names and phone numbers stay in identity_vault. Additive only.

CREATE TABLE "public"."safety_incidents" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "raiser_id" TEXT NOT NULL,
    "raiser_role" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "order_id" TEXT,
    "departure_id" TEXT,
    "counterpart_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "category" TEXT,
    "client_id" TEXT NOT NULL,
    "raise_event_id" TEXT,
    "contact_set" BOOLEAN NOT NULL DEFAULT false,
    "contact_at" TIMESTAMP(3),
    "subject_label" TEXT NOT NULL DEFAULT '',
    "vehicle_label" TEXT,
    "pressed_at" TIMESTAMP(3),
    "raised_at" TIMESTAMP(3) NOT NULL,
    "cancel_until" TIMESTAMP(3) NOT NULL,
    "last_lat" DOUBLE PRECISION,
    "last_lng" DOUBLE PRECISION,
    "last_accuracy_m" DOUBLE PRECISION,
    "last_device_at" TIMESTAMP(3),
    "last_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_id" TEXT,
    "escalated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "outcome" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."safety_incident_entries" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "by_id" TEXT,
    "note" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_incident_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."safety_incident_fixes" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "device_at" TIMESTAMP(3) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_incident_fixes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "safety_incidents_state_raised_at_idx" ON "public"."safety_incidents"("state", "raised_at");

CREATE INDEX "safety_incidents_raiser_id_raised_at_idx" ON "public"."safety_incidents"("raiser_id", "raised_at");

CREATE UNIQUE INDEX "safety_incidents_raiser_id_client_id_key" ON "public"."safety_incidents"("raiser_id", "client_id");

CREATE INDEX "safety_incident_entries_incident_id_at_idx" ON "public"."safety_incident_entries"("incident_id", "at");

CREATE INDEX "safety_incident_fixes_incident_id_at_idx" ON "public"."safety_incident_fixes"("incident_id", "at");

-- Supabase lock-down for the new tables (row level security on, nothing granted to anon / authenticated).
SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
