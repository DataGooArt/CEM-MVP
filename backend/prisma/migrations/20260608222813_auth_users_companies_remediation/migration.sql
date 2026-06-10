-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "nit" TEXT,
    "sector" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'Colombia',
    "phone" TEXT,
    "contact_email" TEXT,
    "logo_url" TEXT,
    "subscription_plan" TEXT NOT NULL DEFAULT 'FREE',
    "notification_settings" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization_id" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "domain" TEXT,
    "ip" TEXT,
    "asset_type" TEXT NOT NULL,
    "criticality" TEXT NOT NULL DEFAULT 'MEDIUM',
    "exposure_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "evidence" JSONB DEFAULT '{}',
    "source_tool" TEXT NOT NULL,
    "raw_output" TEXT,
    "cve" TEXT,
    "cvss" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "remediation_status" TEXT,
    "remediation_start_date" TIMESTAMP(3),
    "remediation_end_date" TIMESTAMP(3),
    "responsible" TEXT,
    "post_analysis_date" TIMESTAMP(3),
    "closing_date" TIMESTAMP(3),
    "remediation_evidence" TEXT,
    "closing_notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "content_hash" TEXT,
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMP(3),
    "scan_id" TEXT,
    "first_scan_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SCAN',
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "evidence_files" JSONB DEFAULT '[]',

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "remediation" TEXT NOT NULL,
    "business_impact" TEXT,
    "remediation_plan" JSONB,
    "model" TEXT NOT NULL DEFAULT 'llama3.2',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_domains" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "org_id" TEXT NOT NULL DEFAULT 'org_demo',
    "tools" TEXT[] DEFAULT ARRAY['nmap', 'nuclei']::TEXT[],
    "cron_expr" TEXT NOT NULL DEFAULT '0 2 * * 1',
    "scan_profile" TEXT NOT NULL DEFAULT 'standard',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_scanned" TIMESTAMP(3),
    "next_scan" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_sessions" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "collector_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "org_id" TEXT NOT NULL DEFAULT 'org_demo',
    "findings_accepted" INTEGER NOT NULL DEFAULT 0,
    "findings_errors" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL DEFAULT 'org_demo',
    "domain" TEXT NOT NULL,
    "collector_id" TEXT NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_reports" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL DEFAULT 'org_demo',
    "domain" TEXT NOT NULL,
    "collector_id" TEXT NOT NULL,
    "tools" TEXT[],
    "new_findings" INTEGER NOT NULL DEFAULT 0,
    "recurring_findings" INTEGER NOT NULL DEFAULT 0,
    "stale_findings" INTEGER NOT NULL DEFAULT 0,
    "total_open" INTEGER NOT NULL DEFAULT 0,
    "by_severity" JSONB NOT NULL DEFAULT '{}',
    "new_by_severity" JSONB NOT NULL DEFAULT '{}',
    "risk_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prev_scan_id" TEXT,
    "risk_score_delta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration_sec" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" TEXT[],
    "channel" TEXT NOT NULL DEFAULT 'email',
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "finding_id" TEXT,
    "raw_data" JSONB,
    "parsed_data" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_scan_reports" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "org_id" TEXT NOT NULL DEFAULT 'org_demo',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "executive_summary" TEXT NOT NULL,
    "technical_summary" TEXT NOT NULL,
    "top_risks" JSONB NOT NULL,
    "attack_surface" JSONB NOT NULL,
    "remediation_roadmap" JSONB NOT NULL,
    "compliance_flags" JSONB,
    "segmented_analysis" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_scan_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "roles_organization_id_idx" ON "roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "assets_organization_id_idx" ON "assets"("organization_id");

-- CreateIndex
CREATE INDEX "findings_asset_id_idx" ON "findings"("asset_id");

-- CreateIndex
CREATE INDEX "findings_severity_idx" ON "findings"("severity");

-- CreateIndex
CREATE INDEX "findings_status_idx" ON "findings"("status");

-- CreateIndex
CREATE INDEX "findings_created_at_idx" ON "findings"("created_at");

-- CreateIndex
CREATE INDEX "findings_archived_at_idx" ON "findings"("archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "findings_asset_id_content_hash_key" ON "findings"("asset_id", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_finding_id_key" ON "ai_analyses"("finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_domains_domain_key" ON "monitored_domains"("domain");

-- CreateIndex
CREATE INDEX "scan_sessions_scan_id_idx" ON "scan_sessions"("scan_id");

-- CreateIndex
CREATE INDEX "scan_sessions_collector_id_idx" ON "scan_sessions"("collector_id");

-- CreateIndex
CREATE INDEX "scan_sessions_created_at_idx" ON "scan_sessions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scan_jobs_scan_id_key" ON "scan_jobs"("scan_id");

-- CreateIndex
CREATE INDEX "scan_jobs_org_id_idx" ON "scan_jobs"("org_id");

-- CreateIndex
CREATE INDEX "scan_jobs_domain_idx" ON "scan_jobs"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "scan_reports_scan_id_key" ON "scan_reports"("scan_id");

-- CreateIndex
CREATE INDEX "scan_reports_org_id_idx" ON "scan_reports"("org_id");

-- CreateIndex
CREATE INDEX "scan_reports_domain_idx" ON "scan_reports"("domain");

-- CreateIndex
CREATE INDEX "scan_reports_created_at_idx" ON "scan_reports"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_type_idx" ON "audit_logs"("type");

-- CreateIndex
CREATE INDEX "audit_logs_finding_id_idx" ON "audit_logs"("finding_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "telemetry_events_type_idx" ON "telemetry_events"("type");

-- CreateIndex
CREATE INDEX "telemetry_events_created_at_idx" ON "telemetry_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_scan_reports_scan_id_key" ON "ai_scan_reports"("scan_id");

-- CreateIndex
CREATE INDEX "ai_scan_reports_org_id_idx" ON "ai_scan_reports"("org_id");

-- CreateIndex
CREATE INDEX "ai_scan_reports_created_at_idx" ON "ai_scan_reports"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
