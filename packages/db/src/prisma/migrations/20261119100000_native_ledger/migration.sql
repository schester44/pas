-- CreateTable
CREATE TABLE "ledger_accounts" (
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("tenant_id","code")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "effective_on" DATE NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "reverses_id" UUID,
    "billing_event_id" TEXT,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lines" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "account_code" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "effective_on" DATE NOT NULL,
    "payer_type" TEXT,
    "payer_ref" TEXT,
    "policy_id" UUID,
    "invoice_id" UUID,
    "payment_id" UUID,
    "agency_id" TEXT,
    "jurisdiction" TEXT,

    CONSTRAINT "ledger_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_balances" (
    "tenant_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_balances_pkey" PRIMARY KEY ("tenant_id","account_code","currency")
);

-- CreateTable
CREATE TABLE "ledger_sequences" (
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "ledger_sequences_pkey" PRIMARY KEY ("tenant_id","kind")
);

-- CreateTable
CREATE TABLE "ledger_receivables" (
    "tenant_id" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "payer_type" TEXT NOT NULL,
    "payer_ref" TEXT,
    "payer_name" TEXT,
    "currency" CHAR(3) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "jurisdiction" TEXT,
    "statement_id" UUID,
    "statement_number" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_receivables_pkey" PRIMARY KEY ("tenant_id","invoice_id")
);

-- CreateTable
CREATE TABLE "ledger_payments" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rail" TEXT NOT NULL,
    "payer_type" TEXT,
    "payer_ref" TEXT,
    "payer_name" TEXT,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "applied" DECIMAL(18,2) NOT NULL,
    "refunded" DECIMAL(18,2) NOT NULL,
    "received_on" DATE NOT NULL,
    "reference" TEXT,
    "provider" TEXT,
    "provider_ref" TEXT,
    "batch_id" UUID,
    "status" TEXT NOT NULL,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMPTZ(6),
    "memo" TEXT,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_applications" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "statement_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL,
    "reversed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ledger_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_deposit_batches" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rail" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "deposited_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_deposit_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lockbox_imports" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "rows" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "exceptions" INTEGER NOT NULL,
    "imported_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_lockbox_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lockbox_items" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "import_id" UUID NOT NULL,
    "row" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "matched_by" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "payment_id" UUID,
    "invoice_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_lockbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_refunds" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payment_id" UUID,
    "invoice_id" UUID,
    "payer_name" TEXT,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "check_number" TEXT,
    "provider_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_write_offs" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_write_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_settings" (
    "tenant_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "small_balance_write_off" DECIMAL(18,2),
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "ledger_idempotency_keys" (
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_idempotency_keys_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "ledger_audit_entries" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "idempotency_key" TEXT,

    CONSTRAINT "ledger_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_reconciliations" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "as_of" DATE NOT NULL,
    "ran_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "ledger_total" DECIMAL(18,2) NOT NULL,
    "pas_total" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "invoices" INTEGER NOT NULL,
    "differences" JSONB NOT NULL,
    "cache_drift" JSONB NOT NULL,

    CONSTRAINT "ledger_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_tenant_id_role_key" ON "ledger_accounts"("tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_id_key" ON "ledger_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_recorded_at_idx" ON "ledger_entries"("tenant_id", "recorded_at");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_source_type_source_id_idx" ON "ledger_entries"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_tenant_id_idempotency_key_key" ON "ledger_entries"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_tenant_id_number_key" ON "ledger_entries"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "ledger_lines_tenant_id_account_code_effective_on_idx" ON "ledger_lines"("tenant_id", "account_code", "effective_on");

-- CreateIndex
CREATE INDEX "ledger_lines_tenant_id_invoice_id_idx" ON "ledger_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ledger_lines_tenant_id_policy_id_idx" ON "ledger_lines"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "ledger_lines_tenant_id_payment_id_idx" ON "ledger_lines"("tenant_id", "payment_id");

-- CreateIndex
CREATE INDEX "ledger_lines_tenant_id_entry_id_idx" ON "ledger_lines"("tenant_id", "entry_id");

-- CreateIndex
CREATE INDEX "ledger_receivables_tenant_id_number_idx" ON "ledger_receivables"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "ledger_receivables_tenant_id_policy_number_idx" ON "ledger_receivables"("tenant_id", "policy_number");

-- CreateIndex
CREATE INDEX "ledger_receivables_tenant_id_payer_type_payer_ref_idx" ON "ledger_receivables"("tenant_id", "payer_type", "payer_ref");

-- CreateIndex
CREATE INDEX "ledger_receivables_tenant_id_statement_number_idx" ON "ledger_receivables"("tenant_id", "statement_number");

-- CreateIndex
CREATE INDEX "ledger_payments_tenant_id_status_received_on_idx" ON "ledger_payments"("tenant_id", "status", "received_on");

-- CreateIndex
CREATE INDEX "ledger_payments_tenant_id_payer_type_payer_ref_idx" ON "ledger_payments"("tenant_id", "payer_type", "payer_ref");

-- CreateIndex
CREATE INDEX "ledger_payments_tenant_id_batch_id_idx" ON "ledger_payments"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "ledger_payments_tenant_id_provider_provider_ref_idx" ON "ledger_payments"("tenant_id", "provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_payments_tenant_id_number_key" ON "ledger_payments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "ledger_applications_tenant_id_payment_id_idx" ON "ledger_applications"("tenant_id", "payment_id");

-- CreateIndex
CREATE INDEX "ledger_applications_tenant_id_invoice_id_idx" ON "ledger_applications"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_applications_tenant_id_event_id_key" ON "ledger_applications"("tenant_id", "event_id");

-- CreateIndex
CREATE INDEX "ledger_deposit_batches_tenant_id_status_idx" ON "ledger_deposit_batches"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_deposit_batches_tenant_id_number_key" ON "ledger_deposit_batches"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "ledger_lockbox_imports_tenant_id_imported_at_idx" ON "ledger_lockbox_imports"("tenant_id", "imported_at");

-- CreateIndex
CREATE INDEX "ledger_lockbox_items_tenant_id_import_id_row_idx" ON "ledger_lockbox_items"("tenant_id", "import_id", "row");

-- CreateIndex
CREATE INDEX "ledger_lockbox_items_tenant_id_status_idx" ON "ledger_lockbox_items"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ledger_refunds_tenant_id_status_idx" ON "ledger_refunds"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_refunds_tenant_id_number_key" ON "ledger_refunds"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "ledger_write_offs_tenant_id_status_idx" ON "ledger_write_offs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ledger_write_offs_tenant_id_invoice_id_idx" ON "ledger_write_offs"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ledger_audit_entity_idx" ON "ledger_audit_entries"("tenant_id", "entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_audit_entries_tenant_id_occurred_at_idx" ON "ledger_audit_entries"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_reconciliations_tenant_id_ran_at_idx" ON "ledger_reconciliations"("tenant_id", "ran_at");


ALTER TABLE "ledger_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_accounts"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_entries"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_lines"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_balances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_balances"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_sequences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_sequences"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_receivables" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_receivables"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_payments"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_applications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_applications"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_deposit_batches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_deposit_batches"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_lockbox_imports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_lockbox_imports"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_lockbox_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_lockbox_items"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_refunds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_refunds"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_write_offs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_write_offs"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_settings"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_idempotency_keys" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_idempotency_keys"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_audit_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_audit_entries"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "ledger_reconciliations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_reconciliations"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Journal entries, their lines and the audit trail are append-only: corrections are new rows.
CREATE FUNCTION ledger_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; post a reversing entry instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
CREATE TRIGGER ledger_lines_append_only BEFORE UPDATE OR DELETE ON "ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
CREATE TRIGGER ledger_audit_entries_append_only BEFORE UPDATE OR DELETE ON "ledger_audit_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_mutation();
CREATE TRIGGER ledger_lines_no_truncate BEFORE TRUNCATE ON "ledger_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_mutation();

-- Every entry balances per currency, checked at commit so all its lines are in.
CREATE FUNCTION ledger_assert_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  unbalanced text;
BEGIN
  SELECT currency INTO unbalanced
  FROM "ledger_lines"
  WHERE entry_id = NEW.entry_id
  GROUP BY currency
  HAVING SUM(amount) <> 0
  LIMIT 1;

  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'Journal entry % does not balance in %', NEW.entry_id, unbalanced
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_lines_balanced AFTER INSERT ON "ledger_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_balanced();
