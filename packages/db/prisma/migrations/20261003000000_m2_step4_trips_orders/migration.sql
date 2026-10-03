-- M2 Step 4 (trips + orders): additive columns only. No data rewrite, safe on a live database.

-- Edge-case review A.12 (scheduled-order offer timing), A.2 (merchant heartbeat), A.16 (order caps per vehicle class).
ALTER TABLE "public"."orders"
  ADD COLUMN "merchant_offered_at" TIMESTAMP(3),
  ADD COLUMN "promised_ready_at" TIMESTAMP(3),
  ADD COLUMN "min_vehicle_class" "public"."VehicleClass";

-- Vehicle-class requirement snapshotted per attachment; acceptance checks the max over active links.
ALTER TABLE "public"."trip_orders"
  ADD COLUMN "min_vehicle_class" "public"."VehicleClass";

-- Where the stop is: the 60 m arrival geofence is drawn around this pin (domain §2).
ALTER TABLE "public"."stops"
  ADD COLUMN "target_pin" geography(Point, 4326);
