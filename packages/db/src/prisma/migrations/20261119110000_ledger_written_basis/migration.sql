-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "commission_basis" TEXT;

-- AlterTable
ALTER TABLE "ledger_receivables" ADD COLUMN     "billed_on" DATE;

-- AlterTable
ALTER TABLE "ledger_settings" ADD COLUMN     "receivable_basis" TEXT NOT NULL DEFAULT 'installment';

-- CreateTable
CREATE TABLE "ledger_commissions" (
    "tenant_id" TEXT NOT NULL,
    "financial_transaction_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "agency_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "basis" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_commissions_pkey" PRIMARY KEY ("tenant_id","financial_transaction_id")
);

-- CreateIndex
CREATE INDEX "ledger_commissions_tenant_id_policy_id_idx" ON "ledger_commissions"("tenant_id", "policy_id");


ALTER TABLE "ledger_commissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_commissions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
