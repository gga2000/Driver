-- Migration 20261002000000_m2_domain — Driver (درايفر) Milestone 2, Step 1.
--
-- Hand-maintained (plan Step 1): the schema engine cannot run in the sandbox, so the DDL below was
-- produced from prisma/schema.prisma by scripts/schema-to-sql.ts using Prisma's naming conventions,
-- then edited for the parts Prisma cannot express:
--   1. CREATE EXTENSION postgis and the `vault` schema (domain §13)
--   2. GIST indexes on every geography column
--   3. trail_points partitioned monthly by `at` (plan Step 1) with a helper to add partitions
--   4. append-only trigger on ledger_events and vault.vault_access_logs (no UPDATE/DELETE ever)
--   5. updated_at maintained by trigger as a safety net for raw SQL writers
-- Verify against a real database with: pnpm db:reset && pnpm db:migrate && prisma migrate diff
-- --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …

-- ───────────── extensions & schemas ─────────────
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE SCHEMA IF NOT EXISTS "vault";

-- ───────────── enums ─────────────
CREATE TYPE "public"."RoleKind" AS ENUM ('customer', 'courier', 'shopper', 'driver', 'intercity_driver', 'khat_driver', 'merchant_staff', 'merchant_owner', 'fleet_owner', 'guardian', 'field_ops', 'dispatcher', 'support', 'finance', 'admin');
CREATE TYPE "public"."TrustTier" AS ENUM ('new', 'bronze', 'silver', 'gold');
CREATE TYPE "public"."OrgType" AS ENUM ('restaurant', 'grocer', 'fleet', 'household');
CREATE TYPE "public"."OrgMemberRole" AS ENUM ('payer', 'orderer', 'member');
CREATE TYPE "public"."GuardianLinkState" AS ENUM ('pending', 'active', 'revoked');
CREATE TYPE "public"."OtpPurpose" AS ENUM ('login', 'reverify', 'number_change', 'guardian_consent');
CREATE TYPE "public"."VehicleClass" AS ENUM ('bike', 'tuktuk', 'car', 'suv', 'van', 'intercity');
CREATE TYPE "public"."ZoneTier" AS ENUM ('centre', 'near', 'mid', 'far', 'edge');
CREATE TYPE "public"."Vertical" AS ENUM ('food', 'grocery', 'errand', 'parcel', 'taxi', 'tuktuk', 'intercity', 'khat');
CREATE TYPE "public"."ComponentKey" AS ENUM ('base', 'distance', 'time', 'zone_adjust', 'front_seat', 'door_pickup', 'street_pickup', 'wait', 'night', 'weather', 'peak', 'pickup_compensation', 'service_fee', 'small_order', 'promo', 'cancellation', 'points_redeemed');
CREATE TYPE "public"."Visibility" AS ENUM ('shown', 'shadow');
CREATE TYPE "public"."DriverShareRule" AS ENUM ('driver_full', 'driver_commissioned', 'platform_only');
CREATE TYPE "public"."OrderType" AS ENUM ('food', 'grocery_catalog', 'errand', 'parcel', 'ride', 'seat', 'subscription');
CREATE TYPE "public"."OrderState" AS ENUM ('placed', 'merchant_accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'closed', 'matched', 'completed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'disputed', 'failed');
CREATE TYPE "public"."PaymentMethod" AS ENUM ('cash', 'wallet', 'prepaid');
CREATE TYPE "public"."RefundState" AS ENUM ('none', 'requested', 'credited', 'cash_refunded', 'denied');
CREATE TYPE "public"."ParticipantRole" AS ENUM ('recipient', 'diner', 'rider', 'parcel_recipient');
CREATE TYPE "public"."ParcelSize" AS ENUM ('envelope', 'small', 'medium', 'large');
CREATE TYPE "public"."TripState" AS ENUM ('created', 'offered', 'accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff', 'completed', 'declined', 'timed_out', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed');
CREATE TYPE "public"."StopType" AS ENUM ('pickup', 'dropoff', 'wait', 'shop');
CREATE TYPE "public"."StopState" AS ENUM ('pending', 'arrived', 'completed', 'skipped');
CREATE TYPE "public"."RouteType" AS ENUM ('khat', 'intercity');
CREATE TYPE "public"."RouteState" AS ENUM ('draft', 'active', 'paused', 'ended');
CREATE TYPE "public"."DepartureState" AS ENUM ('scheduled', 'boarding', 'departed', 'arrived', 'closed', 'cancelled_by_driver', 'cancelled_low_fill');
CREATE TYPE "public"."SeatPosition" AS ENUM ('front', 'back_left', 'back_middle', 'back_right', 'row_2_left', 'row_2_middle', 'row_2_right', 'row_3_left', 'row_3_middle', 'row_3_right', 'parcel');
CREATE TYPE "public"."SeatState" AS ENUM ('held', 'booked', 'checked_in', 'completed', 'cancelled_by_rider', 'no_show', 'moved');
CREATE TYPE "public"."TravellingAs" AS ENUM ('rijal', 'nisa', 'aila');
CREATE TYPE "public"."SubscriptionState" AS ENUM ('trial', 'active', 'past_due', 'cancelled');
CREATE TYPE "public"."PromoFunder" AS ENUM ('platform', 'merchant', 'driver_pool', 'referral');
CREATE TYPE "public"."IncidentState" AS ENUM ('open', 'investigating', 'resolved', 'closed');
CREATE TYPE "public"."LedgerKind" AS ENUM ('money', 'points');
CREATE TYPE "public"."LedgerEventType" AS ENUM ('cash_collected', 'commission_accrued', 'merchant_payable', 'driver_settlement', 'merchant_payout', 'refund', 'credit_issued', 'cancellation_fee', 'promo_funded', 'seat_premium', 'subscription_charge', 'subscription_proration', 'late_penalty_driver', 'late_penalty_rider_credit', 'departure_cancel_fee', 'errand_cost_actual', 'errand_fee', 'tip', 'parcel_fee', 'adjustment', 'merchant_paid_by_courier', 'merchant_settlement_requested', 'debt_settled', 'cash_rounding_credit', 'refund_cash_delivered', 'points_earned', 'points_pending', 'points_claimed', 'points_redeemed', 'points_expired', 'organizer_bonus');
CREATE TYPE "public"."SettlementMode" AS ENUM ('nightly_courier', 'on_demand', 'daily_zaincash', 'weekly_bulk');
CREATE TYPE "public"."OutboxStatus" AS ENUM ('pending', 'published', 'failed');
CREATE TYPE "public"."DispatchOfferState" AS ENUM ('sent', 'seen', 'accepted', 'declined', 'timed_out', 'withdrawn');

-- ───────────── tables ─────────────
CREATE TABLE "public"."people" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar-IQ',
    "trust_tier" "public"."TrustTier" NOT NULL DEFAULT 'new',
    "last_verified_at" TIMESTAMP(3),
    "shared_family_phone" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."roles" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "kind" "public"."RoleKind" NOT NULL,
    "org_id" TEXT,
    "granted_by" TEXT,
    "frozen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."orgs" (
    "id" TEXT NOT NULL,
    "type" "public"."OrgType" NOT NULL,
    "name" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "auto_accept" BOOLEAN NOT NULL DEFAULT false,
    "busy_mode" BOOLEAN NOT NULL DEFAULT false,
    "last_heartbeat" TIMESTAMP(3),
    "pause_windows" JSONB NOT NULL DEFAULT '[]',
    "payout_settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."org_members" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role" "public"."OrgMemberRole" NOT NULL DEFAULT 'member',
    "spending_limit_iqd" INTEGER,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."devices" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "fingerprint" TEXT NOT NULL,
    "push_token" TEXT,
    "verified_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."sessions" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "device_id" TEXT,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."otp_challenges" (
    "id" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "public"."OtpPurpose" NOT NULL DEFAULT 'login',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."guardian_links" (
    "id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "ward_person_id" TEXT,
    "ward_participant_id" TEXT,
    "state" "public"."GuardianLinkState" NOT NULL DEFAULT 'pending',
    "consented_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "guardian_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vault"."person_identities" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "name" TEXT,
    "document_refs" JSONB NOT NULL DEFAULT '[]',
    "selfie_refs" JSONB NOT NULL DEFAULT '[]',
    "selfie_dropped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "person_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vault"."vault_access_logs" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "accessor_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "fields_read" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vault_access_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."vehicles" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "class" "public"."VehicleClass" NOT NULL,
    "owner_org_id" TEXT,
    "active_driver_id" TEXT,
    "seat_map" JSONB NOT NULL DEFAULT '[]',
    "parcel_capacity" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."cities" (
    "id" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Baghdad',
    "rounding_step" INTEGER NOT NULL DEFAULT 250,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."zones" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "tier" "public"."ZoneTier" NOT NULL,
    "ext_id" TEXT,
    "polygon" geography(Polygon, 4326) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "tuktuk_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."places" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "owner_id" TEXT,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "local_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "pin" geography(Point, 4326) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "landmark" BOOLEAN NOT NULL DEFAULT false,
    "landmark_state" TEXT,
    "shares" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "flagged_at" TIMESTAMP(3),
    "arrival_samples" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."place_photos" (
    "id" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "place_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."meeting_points" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "zone_id" TEXT,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "pin" geography(Point, 4326) NOT NULL,
    "photo_url" TEXT,
    "reachable_by" "public"."VehicleClass"[] NOT NULL DEFAULT ARRAY[]::"public"."VehicleClass"[],
    "garage" BOOLEAN NOT NULL DEFAULT false,
    "geofence_m" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."taxonomy_nodes" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "slug" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "taxonomy_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."catalogs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "branch_key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."catalog_items" (
    "id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "taxonomy_id" TEXT,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "price_iqd" INTEGER NOT NULL,
    "photo_url" TEXT,
    "stock" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "availability" JSONB NOT NULL DEFAULT '[]',
    "prep_time_min" INTEGER NOT NULL DEFAULT 15,
    "learned_prep_min" INTEGER,
    "branch_overrides" JSONB NOT NULL DEFAULT '{}',
    "spice" INTEGER,
    "portion" TEXT,
    "points_eligible" BOOLEAN NOT NULL DEFAULT true,
    "hot" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."modifier_groups" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."modifiers" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "price_iqd" INTEGER NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."quotes" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "vertical" "public"."Vertical" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IQD',
    "subtotal_iqd" INTEGER NOT NULL,
    "total_iqd" INTEGER NOT NULL,
    "shadow_total_iqd" INTEGER NOT NULL,
    "request" JSONB NOT NULL,
    "parent_quote_id" TEXT,
    "locked_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."quote_components" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "key" "public"."ComponentKey" NOT NULL,
    "label_ar" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "driver_share_rule" "public"."DriverShareRule" NOT NULL,
    "visibility" "public"."Visibility" NOT NULL,
    "leg" INTEGER,
    "promotion_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quote_components_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."orders" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "type" "public"."OrderType" NOT NULL,
    "state" "public"."OrderState" NOT NULL DEFAULT 'placed',
    "orderer_id" TEXT NOT NULL,
    "merchant_org_id" TEXT,
    "household_org_id" TEXT,
    "quote_id" TEXT,
    "payment_method" "public"."PaymentMethod" NOT NULL DEFAULT 'cash',
    "prepay_required" BOOLEAN NOT NULL DEFAULT false,
    "arriving_call_at" TIMESTAMP(3),
    "items_total_iqd" INTEGER NOT NULL DEFAULT 0,
    "delivery_fee_iqd" INTEGER NOT NULL DEFAULT 0,
    "service_fee_iqd" INTEGER NOT NULL DEFAULT 0,
    "discount_iqd" INTEGER NOT NULL DEFAULT 0,
    "tip_iqd" INTEGER NOT NULL DEFAULT 0,
    "total_iqd" INTEGER NOT NULL DEFAULT 0,
    "ceiling_iqd" INTEGER,
    "receipt_total_iqd" INTEGER,
    "receipt_photo_url" TEXT,
    "refund_state" "public"."RefundState" NOT NULL DEFAULT 'none',
    "note" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "payer_approved_at" TIMESTAMP(3),
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "preparing_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "cancellation_fee_iqd" INTEGER NOT NULL DEFAULT 0,
    "rated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "catalog_item_id" TEXT,
    "free_text" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price_iqd" INTEGER NOT NULL,
    "modifiers" JSONB NOT NULL DEFAULT '[]',
    "participant_id" TEXT,
    "note" TEXT,
    "points_eligible" BOOLEAN NOT NULL DEFAULT true,
    "substitution" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."participants" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "role" "public"."ParticipantRole" NOT NULL,
    "person_id" TEXT,
    "phone_hash" TEXT,
    "label" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."trip_orders" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "attached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detached_at" TIMESTAMP(3),
    "reason" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trip_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."parcels" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "size_class" "public"."ParcelSize" NOT NULL,
    "declared_value_iqd" INTEGER NOT NULL DEFAULT 0,
    "fragile" BOOLEAN NOT NULL DEFAULT false,
    "prohibited_ack" BOOLEAN NOT NULL DEFAULT false,
    "pin_hash" TEXT,
    "photo_pickup_url" TEXT,
    "photo_dropoff_url" TEXT,
    "pin_verified_at" TIMESTAMP(3),
    "release_requested_at" TIMESTAMP(3),
    "release_approved_at" TIMESTAMP(3),
    "refused_at" TIMESTAMP(3),
    "refusal_photo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parcels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."trips" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "vertical" "public"."Vertical" NOT NULL,
    "state" "public"."TripState" NOT NULL DEFAULT 'created',
    "courier_id" TEXT,
    "vehicle_id" TEXT,
    "route_id" TEXT,
    "departure_id" TEXT,
    "quote_id" TEXT,
    "batch_id" TEXT,
    "offered_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "unreachable_started_at" TIMESTAMP(3),
    "unreachable_escalated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "rebroadcast_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."stops" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "order_id" TEXT,
    "type" "public"."StopType" NOT NULL,
    "state" "public"."StopState" NOT NULL DEFAULT 'pending',
    "place_id" TEXT,
    "meeting_point_id" TEXT,
    "zone_key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "geofence_entered_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "arrived_outside_geofence" BOOLEAN NOT NULL DEFAULT false,
    "arrivalPin" geography(Point, 4326),
    "arrival_distance_m" INTEGER,
    "completed_at" TIMESTAMP(3),
    "skipped_at" TIMESTAMP(3),
    "skip_reason" TEXT,
    "handover_proof" JSONB NOT NULL DEFAULT '{}',
    "child_tap_in_at" TIMESTAMP(3),
    "child_tap_out_at" TIMESTAMP(3),
    "child_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."trail_points" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT,
    "driver_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "pin" geography(Point, 4326) NOT NULL,
    "speed_kmh" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "accuracy_m" DOUBLE PRECISION,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trail_points_pkey" PRIMARY KEY ("id", "at")
) PARTITION BY RANGE ("at");

CREATE TABLE "public"."routes" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "type" "public"."RouteType" NOT NULL,
    "state" "public"."RouteState" NOT NULL DEFAULT 'draft',
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "stops" JSONB NOT NULL DEFAULT '[]',
    "schedule" TEXT NOT NULL,
    "driver_id" TEXT,
    "vehicle_id" TEXT,
    "seat_map" JSONB NOT NULL DEFAULT '[]',
    "family_only" BOOLEAN NOT NULL DEFAULT false,
    "seat_price_iqd" INTEGER,
    "monthly_price_iqd" INTEGER,
    "substitute_pool" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."departures" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "announced_at" TIMESTAMP(3) NOT NULL,
    "latest_departure_at" TIMESTAMP(3),
    "state" "public"."DepartureState" NOT NULL DEFAULT 'scheduled',
    "driver_id" TEXT,
    "vehicle_id" TEXT,
    "parcel_slots" INTEGER NOT NULL DEFAULT 0,
    "min_seats" INTEGER NOT NULL DEFAULT 3,
    "driver_checked_in_at" TIMESTAMP(3),
    "late_meter_started_at" TIMESTAMP(3),
    "boarding_at" TIMESTAMP(3),
    "departed_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "departures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."seats" (
    "id" TEXT NOT NULL,
    "departure_id" TEXT NOT NULL,
    "position" "public"."SeatPosition" NOT NULL,
    "state" "public"."SeatState" NOT NULL DEFAULT 'held',
    "rider_id" TEXT,
    "participant_id" TEXT,
    "order_id" TEXT,
    "travelling_as" "public"."TravellingAs",
    "price_iqd" INTEGER NOT NULL,
    "prepaid" BOOLEAN NOT NULL DEFAULT false,
    "walk_up" BOOLEAN NOT NULL DEFAULT false,
    "held_until" TIMESTAMP(3),
    "checked_in_at" TIMESTAMP(3),
    "no_show_at" TIMESTAMP(3),
    "moved_to_seat_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."subscriptions" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "guardian_id" TEXT,
    "state" "public"."SubscriptionState" NOT NULL DEFAULT 'trial',
    "seat_position" "public"."SeatPosition",
    "monthly_price_iqd" INTEGER NOT NULL,
    "proration_iqd" INTEGER NOT NULL DEFAULT 0,
    "trial_ends_at" TIMESTAMP(3),
    "billing_cycle_start" TIMESTAMP(3) NOT NULL,
    "next_billing_at" TIMESTAMP(3),
    "past_due_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."promotions" (
    "id" TEXT NOT NULL,
    "city_id" TEXT,
    "code" TEXT,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "funder" "public"."PromoFunder" NOT NULL,
    "merchant_org_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "effect" JSONB NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "audience" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "budget_cap_iqd" INTEGER,
    "spent_iqd" INTEGER NOT NULL DEFAULT 0,
    "holdout_pct" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "auto_apply" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."promo_redemptions" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."incidents" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" "public"."IncidentState" NOT NULL DEFAULT 'open',
    "trip_id" TEXT,
    "order_id" TEXT,
    "opened_by_id" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "default_outcome" TEXT,
    "resolution" TEXT,
    "resolved_by_id" TEXT,
    "manual_review" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ledger_events" (
    "id" TEXT NOT NULL,
    "kind" "public"."LedgerKind" NOT NULL DEFAULT 'money',
    "type" "public"."LedgerEventType" NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IQD',
    "from_account" TEXT NOT NULL,
    "to_account" TEXT NOT NULL,
    "trip_id" TEXT,
    "order_id" TEXT,
    "route_id" TEXT,
    "departure_id" TEXT,
    "posting_group_id" TEXT,
    "idempotency_key" TEXT,
    "memo" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ledger_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."merchant_settlements" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "mode" "public"."SettlementMode" NOT NULL DEFAULT 'nightly_courier',
    "exposure_cap_iqd" INTEGER NOT NULL DEFAULT 300000,
    "pin_hash" TEXT,
    "zaincash_ref" TEXT,
    "last_settled_at" TIMESTAMP(3),
    "last_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchant_settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."events" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "type" TEXT NOT NULL,
    "aggregate" TEXT,
    "aggregate_id" TEXT,
    "trip_id" TEXT,
    "order_id" TEXT,
    "location" geography(Point, 4326),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_uptime_ms" BIGINT,
    "skew_ms" INTEGER,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,
    "quarantine_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."outbox" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."subscriber_deliveries" (
    "id" TEXT NOT NULL,
    "outbox_id" TEXT NOT NULL,
    "subscriber" TEXT NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriber_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."dispatch_offers" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "wave" INTEGER NOT NULL DEFAULT 1,
    "pass" INTEGER NOT NULL DEFAULT 1,
    "state" "public"."DispatchOfferState" NOT NULL DEFAULT 'sent',
    "rank" INTEGER,
    "distance_km" DOUBLE PRECISION,
    "compensation_iqd" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dispatch_offers_pkey" PRIMARY KEY ("id")
);

-- ───────────── unique constraints & indexes ─────────────
CREATE INDEX "people_trust_tier_idx" ON "public"."people"("trust_tier");
CREATE UNIQUE INDEX "roles_person_id_kind_org_id_key" ON "public"."roles"("person_id", "kind", "org_id");
CREATE INDEX "roles_person_id_idx" ON "public"."roles"("person_id");
CREATE INDEX "orgs_city_id_type_idx" ON "public"."orgs"("city_id", "type");
CREATE UNIQUE INDEX "org_members_org_id_person_id_key" ON "public"."org_members"("org_id", "person_id");
CREATE UNIQUE INDEX "devices_person_id_fingerprint_key" ON "public"."devices"("person_id", "fingerprint");
CREATE INDEX "devices_fingerprint_idx" ON "public"."devices"("fingerprint");
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "public"."sessions"("refresh_token_hash");
CREATE INDEX "sessions_person_id_expires_at_idx" ON "public"."sessions"("person_id", "expires_at");
CREATE INDEX "otp_challenges_phone_hash_created_at_idx" ON "public"."otp_challenges"("phone_hash", "created_at");
CREATE INDEX "guardian_links_guardian_id_state_idx" ON "public"."guardian_links"("guardian_id", "state");
CREATE INDEX "guardian_links_ward_person_id_idx" ON "public"."guardian_links"("ward_person_id");
CREATE UNIQUE INDEX "person_identities_person_id_key" ON "vault"."person_identities"("person_id");
CREATE UNIQUE INDEX "person_identities_phone_e164_key" ON "vault"."person_identities"("phone_e164");
CREATE UNIQUE INDEX "person_identities_phone_hash_key" ON "vault"."person_identities"("phone_hash");
CREATE INDEX "vault_access_logs_person_id_created_at_idx" ON "vault"."vault_access_logs"("person_id", "created_at");
CREATE INDEX "vault_access_logs_accessor_id_created_at_idx" ON "vault"."vault_access_logs"("accessor_id", "created_at");
CREATE UNIQUE INDEX "vehicles_plate_key" ON "public"."vehicles"("plate");
CREATE INDEX "vehicles_owner_org_id_idx" ON "public"."vehicles"("owner_org_id");
CREATE UNIQUE INDEX "zones_city_id_key_key" ON "public"."zones"("city_id", "key");
CREATE UNIQUE INDEX "zones_city_id_ext_id_key" ON "public"."zones"("city_id", "ext_id");
CREATE INDEX "zones_polygon_idx" ON "public"."zones" USING GIST("polygon");
CREATE INDEX "places_city_id_idx" ON "public"."places"("city_id");
CREATE INDEX "places_owner_id_idx" ON "public"."places"("owner_id");
CREATE INDEX "places_pin_idx" ON "public"."places" USING GIST("pin");
CREATE INDEX "place_photos_place_id_idx" ON "public"."place_photos"("place_id");
CREATE INDEX "meeting_points_city_id_idx" ON "public"."meeting_points"("city_id");
CREATE INDEX "meeting_points_pin_idx" ON "public"."meeting_points" USING GIST("pin");
CREATE UNIQUE INDEX "taxonomy_nodes_slug_key" ON "public"."taxonomy_nodes"("slug");
CREATE INDEX "taxonomy_nodes_parent_id_idx" ON "public"."taxonomy_nodes"("parent_id");
CREATE INDEX "catalogs_org_id_idx" ON "public"."catalogs"("org_id");
CREATE INDEX "catalog_items_org_id_available_idx" ON "public"."catalog_items"("org_id", "available");
CREATE INDEX "catalog_items_catalog_id_idx" ON "public"."catalog_items"("catalog_id");
CREATE INDEX "catalog_items_taxonomy_id_idx" ON "public"."catalog_items"("taxonomy_id");
CREATE INDEX "modifier_groups_item_id_idx" ON "public"."modifier_groups"("item_id");
CREATE INDEX "modifiers_group_id_idx" ON "public"."modifiers"("group_id");
CREATE INDEX "quotes_city_id_vertical_created_at_idx" ON "public"."quotes"("city_id", "vertical", "created_at");
CREATE INDEX "quote_components_quote_id_idx" ON "public"."quote_components"("quote_id");
CREATE UNIQUE INDEX "orders_quote_id_key" ON "public"."orders"("quote_id");
CREATE INDEX "orders_city_id_state_idx" ON "public"."orders"("city_id", "state");
CREATE INDEX "orders_orderer_id_placed_at_idx" ON "public"."orders"("orderer_id", "placed_at");
CREATE INDEX "orders_merchant_org_id_state_idx" ON "public"."orders"("merchant_org_id", "state");
CREATE INDEX "order_lines_order_id_idx" ON "public"."order_lines"("order_id");
CREATE INDEX "order_lines_participant_id_idx" ON "public"."order_lines"("participant_id");
CREATE INDEX "participants_order_id_idx" ON "public"."participants"("order_id");
CREATE INDEX "participants_phone_hash_idx" ON "public"."participants"("phone_hash");
CREATE UNIQUE INDEX "trip_orders_trip_id_order_id_attached_at_key" ON "public"."trip_orders"("trip_id", "order_id", "attached_at");
CREATE INDEX "trip_orders_order_id_detached_at_idx" ON "public"."trip_orders"("order_id", "detached_at");
CREATE UNIQUE INDEX "parcels_order_id_key" ON "public"."parcels"("order_id");
CREATE UNIQUE INDEX "trips_quote_id_key" ON "public"."trips"("quote_id");
CREATE INDEX "trips_city_id_state_idx" ON "public"."trips"("city_id", "state");
CREATE INDEX "trips_courier_id_state_idx" ON "public"."trips"("courier_id", "state");
CREATE INDEX "trips_departure_id_idx" ON "public"."trips"("departure_id");
CREATE INDEX "trips_batch_id_idx" ON "public"."trips"("batch_id");
CREATE UNIQUE INDEX "stops_trip_id_seq_key" ON "public"."stops"("trip_id", "seq");
CREATE INDEX "stops_order_id_idx" ON "public"."stops"("order_id");
CREATE INDEX "trail_points_trip_id_at_idx" ON "public"."trail_points"("trip_id", "at");
CREATE INDEX "trail_points_driver_id_at_idx" ON "public"."trail_points"("driver_id", "at");
CREATE INDEX "trail_points_pin_idx" ON "public"."trail_points" USING GIST("pin");
CREATE INDEX "routes_city_id_type_state_idx" ON "public"."routes"("city_id", "type", "state");
CREATE INDEX "departures_route_id_scheduled_at_idx" ON "public"."departures"("route_id", "scheduled_at");
CREATE INDEX "departures_state_scheduled_at_idx" ON "public"."departures"("state", "scheduled_at");
CREATE UNIQUE INDEX "seats_departure_id_position_key" ON "public"."seats"("departure_id", "position");
CREATE INDEX "seats_rider_id_state_idx" ON "public"."seats"("rider_id", "state");
CREATE INDEX "subscriptions_route_id_state_idx" ON "public"."subscriptions"("route_id", "state");
CREATE INDEX "subscriptions_rider_id_idx" ON "public"."subscriptions"("rider_id");
CREATE UNIQUE INDEX "promotions_code_key" ON "public"."promotions"("code");
CREATE INDEX "promotions_active_starts_at_ends_at_idx" ON "public"."promotions"("active", "starts_at", "ends_at");
CREATE UNIQUE INDEX "promo_redemptions_promotion_id_order_id_key" ON "public"."promo_redemptions"("promotion_id", "order_id");
CREATE INDEX "promo_redemptions_person_id_idx" ON "public"."promo_redemptions"("person_id");
CREATE INDEX "promo_redemptions_fingerprint_idx" ON "public"."promo_redemptions"("fingerprint");
CREATE INDEX "incidents_state_created_at_idx" ON "public"."incidents"("state", "created_at");
CREATE INDEX "incidents_trip_id_idx" ON "public"."incidents"("trip_id");
CREATE INDEX "incidents_order_id_idx" ON "public"."incidents"("order_id");
CREATE UNIQUE INDEX "ledger_events_idempotency_key_key" ON "public"."ledger_events"("idempotency_key");
CREATE INDEX "ledger_events_from_account_occurred_at_idx" ON "public"."ledger_events"("from_account", "occurred_at");
CREATE INDEX "ledger_events_to_account_occurred_at_idx" ON "public"."ledger_events"("to_account", "occurred_at");
CREATE INDEX "ledger_events_kind_occurred_at_idx" ON "public"."ledger_events"("kind", "occurred_at");
CREATE INDEX "ledger_events_posting_group_id_idx" ON "public"."ledger_events"("posting_group_id");
CREATE UNIQUE INDEX "merchant_settlements_org_id_key" ON "public"."merchant_settlements"("org_id");
CREATE UNIQUE INDEX "events_idempotency_key_key" ON "public"."events"("idempotency_key");
CREATE INDEX "events_actor_id_occurred_at_idx" ON "public"."events"("actor_id", "occurred_at");
CREATE INDEX "events_trip_id_idx" ON "public"."events"("trip_id");
CREATE INDEX "events_order_id_idx" ON "public"."events"("order_id");
CREATE INDEX "events_type_recorded_at_idx" ON "public"."events"("type", "recorded_at");
CREATE INDEX "events_quarantined_idx" ON "public"."events"("quarantined");
CREATE UNIQUE INDEX "outbox_idempotency_key_key" ON "public"."outbox"("idempotency_key");
CREATE INDEX "outbox_status_next_attempt_at_created_at_idx" ON "public"."outbox"("status", "next_attempt_at", "created_at");
CREATE INDEX "outbox_aggregate_aggregate_id_idx" ON "public"."outbox"("aggregate", "aggregate_id");
CREATE UNIQUE INDEX "subscriber_deliveries_outbox_id_subscriber_key" ON "public"."subscriber_deliveries"("outbox_id", "subscriber");
CREATE INDEX "dispatch_offers_trip_id_wave_idx" ON "public"."dispatch_offers"("trip_id", "wave");
CREATE INDEX "dispatch_offers_driver_id_state_idx" ON "public"."dispatch_offers"("driver_id", "state");

-- ───────────── foreign keys ─────────────
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."orgs" ADD CONSTRAINT "orgs_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."org_members" ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."org_members" ADD CONSTRAINT "org_members_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."devices" ADD CONSTRAINT "devices_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."guardian_links" ADD CONSTRAINT "guardian_links_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."guardian_links" ADD CONSTRAINT "guardian_links_ward_person_id_fkey" FOREIGN KEY ("ward_person_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."guardian_links" ADD CONSTRAINT "guardian_links_ward_participant_id_fkey" FOREIGN KEY ("ward_participant_id") REFERENCES "public"."participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vault"."person_identities" ADD CONSTRAINT "person_identities_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vault"."vault_access_logs" ADD CONSTRAINT "vault_access_logs_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vault"."vault_access_logs" ADD CONSTRAINT "vault_access_logs_accessor_id_fkey" FOREIGN KEY ("accessor_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "public"."orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_active_driver_id_fkey" FOREIGN KEY ("active_driver_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."zones" ADD CONSTRAINT "zones_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."places" ADD CONSTRAINT "places_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."places" ADD CONSTRAINT "places_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."place_photos" ADD CONSTRAINT "place_photos_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."meeting_points" ADD CONSTRAINT "meeting_points_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."meeting_points" ADD CONSTRAINT "meeting_points_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."catalogs" ADD CONSTRAINT "catalogs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."catalog_items" ADD CONSTRAINT "catalog_items_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."catalog_items" ADD CONSTRAINT "catalog_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."catalog_items" ADD CONSTRAINT "catalog_items_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomy_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."modifier_groups" ADD CONSTRAINT "modifier_groups_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."modifiers" ADD CONSTRAINT "modifiers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."quote_components" ADD CONSTRAINT "quote_components_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_orderer_id_fkey" FOREIGN KEY ("orderer_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_merchant_org_id_fkey" FOREIGN KEY ("merchant_org_id") REFERENCES "public"."orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_household_org_id_fkey" FOREIGN KEY ("household_org_id") REFERENCES "public"."orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."order_lines" ADD CONSTRAINT "order_lines_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."order_lines" ADD CONSTRAINT "order_lines_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."participants" ADD CONSTRAINT "participants_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."participants" ADD CONSTRAINT "participants_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."trip_orders" ADD CONSTRAINT "trip_orders_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."trip_orders" ADD CONSTRAINT "trip_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."trip_orders" ADD CONSTRAINT "trip_orders_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."parcels" ADD CONSTRAINT "parcels_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_departure_id_fkey" FOREIGN KEY ("departure_id") REFERENCES "public"."departures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."stops" ADD CONSTRAINT "stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."stops" ADD CONSTRAINT "stops_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."stops" ADD CONSTRAINT "stops_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."stops" ADD CONSTRAINT "stops_meeting_point_id_fkey" FOREIGN KEY ("meeting_point_id") REFERENCES "public"."meeting_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."trail_points" ADD CONSTRAINT "trail_points_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."trail_points" ADD CONSTRAINT "trail_points_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."routes" ADD CONSTRAINT "routes_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."routes" ADD CONSTRAINT "routes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."routes" ADD CONSTRAINT "routes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."departures" ADD CONSTRAINT "departures_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."departures" ADD CONSTRAINT "departures_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."departures" ADD CONSTRAINT "departures_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_departure_id_fkey" FOREIGN KEY ("departure_id") REFERENCES "public"."departures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."promotions" ADD CONSTRAINT "promotions_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."promotions" ADD CONSTRAINT "promotions_merchant_org_id_fkey" FOREIGN KEY ("merchant_org_id") REFERENCES "public"."orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."promotions" ADD CONSTRAINT "promotions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."promo_redemptions" ADD CONSTRAINT "promo_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."promo_redemptions" ADD CONSTRAINT "promo_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."promo_redemptions" ADD CONSTRAINT "promo_redemptions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."incidents" ADD CONSTRAINT "incidents_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."incidents" ADD CONSTRAINT "incidents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."incidents" ADD CONSTRAINT "incidents_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ledger_events" ADD CONSTRAINT "ledger_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ledger_events" ADD CONSTRAINT "ledger_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ledger_events" ADD CONSTRAINT "ledger_events_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ledger_events" ADD CONSTRAINT "ledger_events_departure_id_fkey" FOREIGN KEY ("departure_id") REFERENCES "public"."departures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."merchant_settlements" ADD CONSTRAINT "merchant_settlements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."events" ADD CONSTRAINT "events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."events" ADD CONSTRAINT "events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."outbox" ADD CONSTRAINT "outbox_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."subscriber_deliveries" ADD CONSTRAINT "subscriber_deliveries_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."dispatch_offers" ADD CONSTRAINT "dispatch_offers_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."dispatch_offers" ADD CONSTRAINT "dispatch_offers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── trail_points: monthly partitions ─────────────
-- Raw position stream is kept forever (domain §13); monthly partitions keep indexes small.
-- `ensure_trail_partition(month)` is idempotent; the API calls it on boot for this and next month,
-- and a default partition catches anything outside the created ranges so inserts never fail.
CREATE OR REPLACE FUNCTION "public"."ensure_trail_partition"(month_start DATE)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  part_name TEXT := 'trail_points_' || to_char(month_start, 'YYYY_MM');
  range_start TIMESTAMP := date_trunc('month', month_start)::timestamp;
  range_end TIMESTAMP := (date_trunc('month', month_start) + interval '1 month')::timestamp;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE "public".%I PARTITION OF "public"."trail_points" FOR VALUES FROM (%L) TO (%L)',
      part_name, range_start, range_end
    );
  END IF;
END $$;

CREATE TABLE "public"."trail_points_default" PARTITION OF "public"."trail_points" DEFAULT;
SELECT "public"."ensure_trail_partition"(date_trunc('month', now())::date);
SELECT "public"."ensure_trail_partition"((date_trunc('month', now()) + interval '1 month')::date);

-- ───────────── append-only ledger ─────────────
-- The ledger is immutable: balances are computed from events and corrections are new `adjustment`
-- rows. Any UPDATE or DELETE is rejected at the database, whatever the application does.
CREATE OR REPLACE FUNCTION "public"."reject_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER "ledger_events_append_only"
  BEFORE UPDATE OR DELETE ON "public"."ledger_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_mutation"();

CREATE TRIGGER "vault_access_logs_append_only"
  BEFORE UPDATE OR DELETE ON "vault"."vault_access_logs"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_mutation"();

-- ───────────── updated_at safety net ─────────────
-- Prisma sets updated_at itself; this covers seeds, migrations and any raw SQL.
CREATE OR REPLACE FUNCTION "public"."set_updated_at"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN
    SELECT table_schema, table_name FROM information_schema.columns
    WHERE column_name = 'updated_at' AND table_schema IN ('public', 'vault')
      AND table_name NOT IN ('ledger_events', 'vault_access_logs')
      AND table_name NOT LIKE 'trail_points_%'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"()',
      t.table_name || '_set_updated_at', t.table_schema, t.table_name);
  END LOOP;
END $$;
