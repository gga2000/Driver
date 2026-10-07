-- Voice notes in the chat (ride ideas n7/n8): a message of kind 'voice' points at its upload (`voice_ref`,
-- an `uploads` row of type audio/*) and carries its length in seconds. The file goes with the chat: once
-- the thread closes the voice retention deletes it and sets `voice_ref` back to NULL (the index finds the
-- few messages that still hold one). Additive only.

-- AlterTable
ALTER TABLE "public"."chat_messages" ADD COLUMN "voice_ref" TEXT,
ADD COLUMN "duration_sec" INTEGER;

ALTER TABLE "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_duration_sec_check" CHECK ("duration_sec" IS NULL OR "duration_sec" BETWEEN 1 AND 60);

-- CreateIndex
CREATE INDEX "chat_messages_voice_ref_idx" ON "public"."chat_messages"("voice_ref");
