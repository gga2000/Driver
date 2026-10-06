-- Customer joy J1d/J1e (Ali, 2026-10-05: J-D6 and J-D10).
-- orders.small_order_fee_iqd: the 500 دينار fee on an order below the restaurant's minimum, fixed at placement.
-- orders.points_redeemed: points the customer spends on the order (delivery fee first, then the service
-- fee), posted by the ledger when the order closes. Both additive with default 0; no new table, so no
-- driver_harden call.
ALTER TABLE "public"."orders" ADD COLUMN "small_order_fee_iqd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "points_redeemed" INTEGER NOT NULL DEFAULT 0;
