-- خطوط sweep alerts, the dispatcher's close (Ali, 2026-10-06): an alert the driver never confirms is
-- closed from the Console with a short reason ("اتصلت بالسايق، السيارة فاضية" / "اتصلت بالأهل" /
-- "غيرها" + a note), recorded with who closed it and when. Closed rows leave the strip; a late driver
-- confirm still sets `confirmed_at`. Staff person id only (no names). Additive only, no new table.

ALTER TABLE "public"."khat_sweep_alerts" ADD COLUMN "closed_at" TIMESTAMP(3);
ALTER TABLE "public"."khat_sweep_alerts" ADD COLUMN "closed_by_id" TEXT;
ALTER TABLE "public"."khat_sweep_alerts" ADD COLUMN "close_reason" TEXT;
ALTER TABLE "public"."khat_sweep_alerts" ADD COLUMN "close_note" TEXT;
