-- In-order chat and share-trip links (notifications & support §2, scoring & safety §5): a thread per
-- order and pair of parties, its messages (Iraqi phone numbers masked by the API before the insert),
-- read receipts, and signed share-trip links. Additive only. No foreign keys to `orders` (owned by
-- the orders module); participants are derived live from the order, never stored.

CREATE TABLE "public"."chat_threads" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."chat_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "quick_reply_key" TEXT,
    "photo_ref" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "client_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."chat_reads" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "reader_key" TEXT NOT NULL,
    "read_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."share_links" (
    "id" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_threads_order_id_kind_key" ON "public"."chat_threads"("order_id", "kind");
CREATE UNIQUE INDEX "chat_messages_thread_id_seq_key" ON "public"."chat_messages"("thread_id", "seq");
CREATE UNIQUE INDEX "chat_messages_thread_id_sender_id_client_id_key" ON "public"."chat_messages"("thread_id", "sender_id", "client_id");
CREATE UNIQUE INDEX "chat_reads_thread_id_reader_key_key" ON "public"."chat_reads"("thread_id", "reader_key");
CREATE INDEX "share_links_subject_kind_subject_id_idx" ON "public"."share_links"("subject_kind", "subject_id");
