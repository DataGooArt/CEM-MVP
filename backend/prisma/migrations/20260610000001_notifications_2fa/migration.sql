-- AlterTable: add two_factor_enabled to users (idempotent)
DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- CreateTable: notifications (idempotent)
CREATE TABLE IF NOT EXISTS "notifications" (
    "id"          TEXT NOT NULL,
    "rule_id"     TEXT,
    "finding_id"  TEXT,
    "channel"     TEXT NOT NULL,
    "target"      TEXT NOT NULL,
    "severity"    TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'SENT',
    "error_msg"   TEXT,
    "sent_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey (idempotent)
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rule_id_fkey"
    FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "notifications_finding_id_idx" ON "notifications"("finding_id");
CREATE INDEX IF NOT EXISTS "notifications_rule_id_idx"   ON "notifications"("rule_id");
CREATE INDEX IF NOT EXISTS "notifications_sent_at_idx"   ON "notifications"("sent_at");
