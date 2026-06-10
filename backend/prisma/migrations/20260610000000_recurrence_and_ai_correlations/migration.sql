-- AlterTable: add recurrence_count to findings
ALTER TABLE "findings" ADD COLUMN "recurrence_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: add correlations and attack_vector to ai_analyses
ALTER TABLE "ai_analyses" ADD COLUMN "correlations" JSONB;
ALTER TABLE "ai_analyses" ADD COLUMN "attack_vector" TEXT;
