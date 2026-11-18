-- CreateEnum
CREATE TYPE "policy_term_status" AS ENUM ('PENDING_EFFECTIVE', 'IN_FORCE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('QUOTED', 'REFERRED', 'DECLINED', 'EXPIRED', 'BOUND');

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "insured_name" TEXT NOT NULL,
    "producer_id" TEXT NOT NULL,
    "producer_name" TEXT NOT NULL,
    "source_submission_id" UUID NOT NULL,
    "source_quote_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_terms" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "term_number" INTEGER NOT NULL,
    "product_release_id" UUID NOT NULL,
    "product_version" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "subdivision" VARCHAR(6),
    "effective_date" DATE NOT NULL,
    "expiration_date" DATE NOT NULL,
    "status" "policy_term_status" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "written_premium" DECIMAL(18,2) NOT NULL,
    "taxes_and_fees" DECIMAL(18,2) NOT NULL,
    "bound_at" TIMESTAMPTZ(6) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "premium_delta" DECIMAL(18,2) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term_versions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "term_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "term_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "coverage" TEXT,
    "exposure" TEXT,
    "remitter" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_date" DATE NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_documents" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_sequences" (
    "tenant_id" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "policy_sequences_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "submission_id" UUID NOT NULL,
    "product_release_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "quote_status" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "premium" DECIMAL(18,2) NOT NULL,
    "taxes_and_fees" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "term_start" DATE NOT NULL,
    "term_end" DATE NOT NULL,
    "risk_data" JSONB NOT NULL,
    "selection" JSONB NOT NULL,
    "evaluation" JSONB NOT NULL,
    "referral" JSONB,
    "details" JSONB,
    "signature" JSONB,
    "payment" JSONB,
    "policy_id" UUID,
    "policy_number" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "bound_at" TIMESTAMPTZ(6),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_payments" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quote_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" JSONB NOT NULL,
    "failure" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quote_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policies_tenant_id_created_at_idx" ON "policies"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "policies_tenant_id_producer_id_created_at_idx" ON "policies"("tenant_id", "producer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "policies_tenant_id_number_key" ON "policies"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "policies_tenant_id_source_quote_id_key" ON "policies"("tenant_id", "source_quote_id");

-- CreateIndex
CREATE INDEX "policy_terms_tenant_id_status_effective_date_idx" ON "policy_terms"("tenant_id", "status", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "policy_terms_tenant_id_policy_id_term_number_key" ON "policy_terms"("tenant_id", "policy_id", "term_number");

-- CreateIndex
CREATE INDEX "policy_transactions_tenant_id_policy_id_recorded_at_idx" ON "policy_transactions"("tenant_id", "policy_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "term_versions_tenant_id_term_id_version_key" ON "term_versions"("tenant_id", "term_id", "version");

-- CreateIndex
CREATE INDEX "financial_transactions_tenant_id_transaction_id_idx" ON "financial_transactions"("tenant_id", "transaction_id");

-- CreateIndex
CREATE INDEX "financial_transactions_tenant_id_policy_id_recorded_at_idx" ON "financial_transactions"("tenant_id", "policy_id", "recorded_at");

-- CreateIndex
CREATE INDEX "policy_documents_tenant_id_policy_id_created_at_idx" ON "policy_documents"("tenant_id", "policy_id", "created_at");

-- CreateIndex
CREATE INDEX "quotes_tenant_id_status_updated_at_idx" ON "quotes"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenant_id_submission_id_key" ON "quotes"("tenant_id", "submission_id");

-- CreateIndex
CREATE INDEX "quote_payments_tenant_id_quote_id_created_at_idx" ON "quote_payments"("tenant_id", "quote_id", "created_at");

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes', 'quote_payments', 'policies', 'policy_terms',
    'policy_transactions', 'term_versions', 'financial_transactions', 'policy_documents',
    'policy_sequences']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;

-- Issued history is append-only (CLAUDE.md rule 6): corrections are new rows, never edits.
CREATE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER term_versions_immutable BEFORE UPDATE OR DELETE ON "term_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER financial_transactions_immutable BEFORE UPDATE OR DELETE ON "financial_transactions"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER policy_transactions_immutable BEFORE UPDATE OR DELETE ON "policy_transactions"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A quote never moves to another release (CLAUDE.md rule 5).
CREATE FUNCTION quotes_pin_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.product_release_id IS DISTINCT FROM OLD.product_release_id OR
     NEW.submission_id IS DISTINCT FROM OLD.submission_id OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'a quote''s release pin is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotes_pin_immutable BEFORE UPDATE ON "quotes"
  FOR EACH ROW EXECUTE FUNCTION quotes_pin_immutable();
