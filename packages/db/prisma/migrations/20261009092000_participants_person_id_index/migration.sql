-- SCALE-02: "my orders" finds the orders a person rides on through this index.
CREATE INDEX "participants_person_id_idx" ON "public"."participants"("person_id");
