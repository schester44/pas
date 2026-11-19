-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "agency_bill_suspended_at" TIMESTAMPTZ(6),
ADD COLUMN     "agency_bill_suspended_reason" TEXT,
ADD COLUMN     "nonpayment_cancels" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminder_days" INTEGER,
ADD COLUMN     "remittance_basis" TEXT NOT NULL DEFAULT 'gross',
ADD COLUMN     "statement_day" INTEGER,
ADD COLUMN     "suspend_after_days" INTEGER;

-- AlterTable
ALTER TABLE "billing_schedules" ADD COLUMN     "payer" TEXT NOT NULL DEFAULT 'insured',
ADD COLUMN     "payer_address" JSONB,
ADD COLUMN     "payer_name" TEXT,
ADD COLUMN     "payer_ref" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "payer_address" JSONB,
ADD COLUMN     "payer_name" TEXT;

-- CreateTable
CREATE TABLE "agency_statements" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agency_id" UUID NOT NULL,
    "agency_name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "remittance_basis" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reminded_on" DATE,
    "suspended_on" DATE,
    "document_key" TEXT,
    "emailed_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_statement_items" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "statement_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_kind" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "insured_name" TEXT NOT NULL,
    "transaction_id" UUID NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "commission" DECIMAL(18,2) NOT NULL,
    "net" DECIMAL(18,2) NOT NULL,
    "due" DECIMAL(18,2) NOT NULL,
    "credited" DECIMAL(18,2) NOT NULL,
    "paid" DECIMAL(18,2) NOT NULL,
    "settlement_credit" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "agency_statement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_statement_sequences" (
    "tenant_id" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "agency_statement_sequences_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "mortgagee_bills" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "term_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "lender_name" TEXT NOT NULL,
    "loan_number" TEXT,
    "lender_address" JSONB,
    "lender_email" TEXT,
    "follow_up" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "sent_on" DATE,
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mortgagee_bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_statements_tenant_id_status_due_on_idx" ON "agency_statements"("tenant_id", "status", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "agency_statements_tenant_id_number_key" ON "agency_statements"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "agency_statements_tenant_id_agency_id_period_end_key" ON "agency_statements"("tenant_id", "agency_id", "period_end");

-- CreateIndex
CREATE INDEX "agency_statement_items_tenant_id_statement_id_position_idx" ON "agency_statement_items"("tenant_id", "statement_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "agency_statement_items_tenant_id_invoice_id_key" ON "agency_statement_items"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "mortgagee_bills_tenant_id_policy_id_idx" ON "mortgagee_bills"("tenant_id", "policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "mortgagee_bills_tenant_id_invoice_id_key" ON "mortgagee_bills"("tenant_id", "invoice_id");


-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agency_statements', 'agency_statement_items',
    'agency_statement_sequences', 'mortgagee_bills']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
