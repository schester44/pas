-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "transaction_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "amount_paid" DECIMAL(18,2) NOT NULL,
    "status" "invoice_status" NOT NULL,
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "coverage" TEXT,
    "exposure" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "method" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "tenant_id" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "policy_events" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "term_id" UUID,
    "transaction_id" UUID,
    "invoice_id" UUID,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "effective_date" DATE,
    "actor" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_activity" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quote_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "quote_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_tenant_id_policy_id_created_at_idx" ON "invoices"("tenant_id", "policy_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_number_key" ON "invoices"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_transaction_id_key" ON "invoices"("tenant_id", "transaction_id");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_invoice_id_position_idx" ON "invoice_lines"("tenant_id", "invoice_id", "position");

-- CreateIndex
CREATE INDEX "payments_tenant_id_policy_id_received_at_idx" ON "payments"("tenant_id", "policy_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_provider_provider_ref_key" ON "payments"("tenant_id", "provider", "provider_ref");

-- CreateIndex
CREATE INDEX "policy_events_tenant_id_policy_id_occurred_at_idx" ON "policy_events"("tenant_id", "policy_id", "occurred_at");

-- CreateIndex
CREATE INDEX "quote_activity_tenant_id_quote_id_occurred_at_idx" ON "quote_activity"("tenant_id", "quote_id", "occurred_at");

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policy_events', 'quote_activity', 'invoices', 'invoice_lines',
    'payments', 'invoice_sequences']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;

-- Timelines, invoice lines and payments are history: corrections are new rows.
CREATE TRIGGER policy_events_immutable BEFORE UPDATE OR DELETE ON "policy_events"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER quote_activity_immutable BEFORE UPDATE OR DELETE ON "quote_activity"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER invoice_lines_immutable BEFORE UPDATE OR DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
