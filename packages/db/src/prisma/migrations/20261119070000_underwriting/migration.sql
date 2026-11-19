-- CreateTable
CREATE TABLE "underwriting_referrals" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quote_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "submission_number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "subdivision" VARCHAR(6),
    "insured_name" TEXT,
    "producer" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "quote" JSONB NOT NULL,
    "required_level" INTEGER NOT NULL,
    "assignee_id" TEXT,
    "assignee" JSONB,
    "escalation" JSONB,
    "decision" JSONB,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "underwriting_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_referral_entries" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "action" TEXT,
    "author" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "underwriting_referral_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_subjectivities" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quote_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "submission_number" TEXT NOT NULL,
    "policy_id" UUID,
    "policy_number" TEXT,
    "referral_id" UUID,
    "inspection_id" UUID,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "timing" TEXT NOT NULL,
    "due_days" INTEGER,
    "due_date" DATE,
    "owner" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "consequence" TEXT,
    "status" TEXT NOT NULL,
    "documents" JSONB NOT NULL,
    "history" JSONB NOT NULL,
    "overdue_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "underwriting_subjectivities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_inspections" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quote_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "submission_number" TEXT NOT NULL,
    "policy_id" UUID,
    "policy_number" TEXT,
    "subjectivity_id" UUID,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "provider_id" TEXT,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "report" JSONB,
    "review" JSONB,
    "history" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "underwriting_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_settings" (
    "tenant_id" TEXT NOT NULL,
    "authority_profiles" JSONB NOT NULL,
    "decline_reasons" JSONB NOT NULL,
    "overdue_consequence" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "underwriting_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "underwriting_referrals_tenant_id_status_due_at_idx" ON "underwriting_referrals"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "underwriting_referrals_tenant_id_quote_id_idx" ON "underwriting_referrals"("tenant_id", "quote_id");

-- CreateIndex
CREATE INDEX "uw_referral_entries_tenant_referral_at_idx" ON "underwriting_referral_entries"("tenant_id", "referral_id", "at");

-- CreateIndex
CREATE INDEX "underwriting_subjectivities_tenant_id_policy_id_idx" ON "underwriting_subjectivities"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "underwriting_subjectivities_tenant_id_status_due_date_idx" ON "underwriting_subjectivities"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "uw_subjectivities_tenant_quote_code_key" ON "underwriting_subjectivities"("tenant_id", "quote_id", "code");

-- CreateIndex
CREATE INDEX "underwriting_inspections_tenant_id_status_updated_at_idx" ON "underwriting_inspections"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "underwriting_inspections_tenant_id_quote_id_code_key" ON "underwriting_inspections"("tenant_id", "quote_id", "code");

-- AddForeignKey
ALTER TABLE "underwriting_referral_entries" ADD CONSTRAINT "underwriting_referral_entries_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "underwriting_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['underwriting_referrals', 'underwriting_referral_entries', 'underwriting_subjectivities', 'underwriting_inspections', 'underwriting_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
