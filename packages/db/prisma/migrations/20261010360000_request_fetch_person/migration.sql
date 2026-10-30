-- Private car round 2 step 3, k1/k2 «جيب واحد» (Ali 2026-10-07): a private-car request may fetch
-- someone else. Additive only. The request keeps the person id; the name the poster gave them lives
-- in identity_vault.participant_identities under 'request:<id>' (no new vault table).
ALTER TABLE "public"."ride_requests" ADD COLUMN "fetch_person_id" TEXT;
