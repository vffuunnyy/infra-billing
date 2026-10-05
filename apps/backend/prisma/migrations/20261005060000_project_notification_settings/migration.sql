CREATE TABLE "project_notification_settings" (
    "project_uuid" TEXT NOT NULL,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "upcoming_billing_days" INTEGER NOT NULL DEFAULT 3,
    "telegram_bot_token_enc" BYTEA,
    "telegram_chat_id" TEXT,
    "telegram_topic_id" TEXT,
    "telegram_proxy_url" TEXT,
    CONSTRAINT "project_notification_settings_pkey" PRIMARY KEY ("project_uuid"),
    CONSTRAINT "project_notification_settings_project_uuid_fkey"
        FOREIGN KEY ("project_uuid") REFERENCES "projects"("uuid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Preserve the old destination once, on the seeded default project. Never broadcast by inheritance.
INSERT INTO "project_notification_settings" (
    "project_uuid", "notifications_enabled", "upcoming_billing_days", "telegram_bot_token_enc",
    "telegram_chat_id", "telegram_topic_id", "telegram_proxy_url"
)
SELECT p."uuid", s."notifications_enabled", s."upcoming_billing_days", s."telegram_bot_token_enc",
       s."telegram_chat_id", s."telegram_topic_id", s."telegram_proxy_url"
FROM "settings" s
JOIN "projects" p ON p."uuid" = '00000000-0000-0000-0000-000000000001'
WHERE s."id" = 1;

-- Keep the existing 24-hour throttle for the migrated destination; retain old rows for rollback.
INSERT INTO "notification_log" ("dedup_key", "sent_at")
SELECT 'project:00000000-0000-0000-0000-000000000001:' || "dedup_key", "sent_at"
FROM "notification_log"
WHERE "sent_at" >= NOW() - INTERVAL '24 hours' AND "dedup_key" NOT LIKE 'project:%';
