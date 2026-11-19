-- CreateTable
CREATE TABLE "compliance_obligations" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "policy_id" UUID,
    "transaction_id" UUID,
    "licensee_id" UUID,
    "anchor_date" DATE NOT NULL,
    "subject" JSONB NOT NULL,
    "responsible" JSONB NOT NULL,
    "channel" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "timer" JSONB NOT NULL,
    "due_date" DATE NOT NULL,
    "late_from" TIMESTAMPTZ(6) NOT NULL,
    "escalation" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "source" JSONB NOT NULL,
    "proof" JSONB,
    "waiver" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "compliance_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_filings" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "obligation_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider_id" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "reference" TEXT,
    "batch_id" UUID,
    "status" TEXT NOT NULL,
    "filing_number" TEXT,
    "stamp_number" TEXT,
    "reasons" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "compliance_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_obligation_events" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "obligation_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "compliance_obligation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_filing_batches" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "obligation_ids" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_filing_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_licensees" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_licensees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_obligations_tenant_id_dedupe_key_key" ON "compliance_obligations"("tenant_id", "dedupe_key");
CREATE INDEX "compliance_obligations_tenant_id_status_late_from_idx" ON "compliance_obligations"("tenant_id", "status", "late_from");
CREATE INDEX "compliance_obligations_tenant_id_policy_id_idx" ON "compliance_obligations"("tenant_id", "policy_id");
CREATE INDEX "compliance_obligations_tenant_id_kind_jurisdiction_licensee_id_anchor_date_idx" ON "compliance_obligations"("tenant_id", "kind", "jurisdiction", "licensee_id", "anchor_date");
CREATE INDEX "compliance_filings_tenant_id_obligation_id_idx" ON "compliance_filings"("tenant_id", "obligation_id");
CREATE INDEX "compliance_obligation_events_tenant_id_obligation_id_occurred_at_idx" ON "compliance_obligation_events"("tenant_id", "obligation_id", "occurred_at");
CREATE INDEX "compliance_filing_batches_tenant_id_created_at_idx" ON "compliance_filing_batches"("tenant_id", "created_at");
CREATE UNIQUE INDEX "compliance_licensees_tenant_id_jurisdiction_license_number_key" ON "compliance_licensees"("tenant_id", "jurisdiction", "license_number");

-- AddForeignKey
ALTER TABLE "compliance_filings" ADD CONSTRAINT "compliance_filings_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "compliance_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_obligation_events" ADD CONSTRAINT "compliance_obligation_events_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "compliance_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_obligations', 'compliance_filings', 'compliance_obligation_events', 'compliance_filing_batches', 'compliance_licensees']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
