-- Review 2026-10-04 #11: OrdersService.merchantOrders reads one merchant's orders in a placed-at range
-- (Merchant app money today / statement / disputes, insights, deal projections).
CREATE INDEX "orders_merchant_org_id_placed_at_idx" ON "public"."orders"("merchant_org_id", "placed_at");
