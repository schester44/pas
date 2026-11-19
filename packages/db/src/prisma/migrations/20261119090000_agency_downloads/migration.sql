-- CreateTable
CREATE TABLE "agency_download_enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agency_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "mailbox" TEXT,
    "agency_codes" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "start_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_download_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_download_items" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agency_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "policy_id" UUID,
    "policy_number" TEXT,
    "transaction_id" UUID,
    "transaction_type" TEXT,
    "effective_date" DATE,
    "title" TEXT NOT NULL,
    "record" JSONB NOT NULL,
    "batch_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "obligation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "agency_download_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_download_batches" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agency_id" UUID NOT NULL,
    "run_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "mailbox" TEXT,
    "format" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "item_ids" JSONB NOT NULL,
    "item_count" INTEGER NOT NULL,
    "reference" TEXT,
    "error" TEXT,
    "resend_of" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "agency_download_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_download_enrollments_tenant_id_agency_id_key" ON "agency_download_enrollments"("tenant_id", "agency_id");

-- CreateIndex
CREATE INDEX "agency_download_items_tenant_id_status_agency_id_idx" ON "agency_download_items"("tenant_id", "status", "agency_id");

-- CreateIndex
CREATE INDEX "agency_download_items_tenant_id_batch_id_idx" ON "agency_download_items"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "agency_download_items_tenant_id_policy_id_idx" ON "agency_download_items"("tenant_id", "policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_download_items_tenant_id_dedupe_key_key" ON "agency_download_items"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "agency_download_batches_tenant_id_created_at_idx" ON "agency_download_batches"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "agency_download_batches_tenant_agency_created_idx" ON "agency_download_batches"("tenant_id", "agency_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agency_download_batches_tenant_id_agency_id_run_key_key" ON "agency_download_batches"("tenant_id", "agency_id", "run_key");


-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agency_download_enrollments', 'agency_download_items', 'agency_download_batches']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
