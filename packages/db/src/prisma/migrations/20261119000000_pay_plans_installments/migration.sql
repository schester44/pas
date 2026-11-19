
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "invoice_status" ADD VALUE 'SCHEDULED';
ALTER TYPE "invoice_status" ADD VALUE 'PAST_DUE';

-- DropIndex
DROP INDEX "invoices_tenant_id_transaction_id_key";

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "transaction_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amount_credited" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "installment" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "installments" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "payer" TEXT NOT NULL DEFAULT 'insured',
ADD COLUMN     "payer_ref" TEXT,
ADD COLUMN     "schedule_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "method_kind" TEXT NOT NULL DEFAULT 'card',
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "policy_terms" ADD COLUMN     "billing_method" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN     "pay_plan" TEXT;

-- AlterTable
ALTER TABLE "product_versions" ADD COLUMN     "billing" JSONB NOT NULL DEFAULT '{"payPlans": []}';

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "pay_plan" TEXT;

-- CreateTable
CREATE TABLE "billing_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "term_id" UUID NOT NULL,
    "billing_method" TEXT NOT NULL DEFAULT 'direct',
    "plan" JSONB NOT NULL,
    "dunning" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "payment_method_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "customer_ref" TEXT,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "consent" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_schedules_tenant_id_policy_id_idx" ON "billing_schedules"("tenant_id", "policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_schedules_tenant_id_term_id_key" ON "billing_schedules"("tenant_id", "term_id");

-- CreateIndex
CREATE INDEX "payment_methods_tenant_id_policy_id_idx" ON "payment_methods"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_schedule_id_idx" ON "invoices"("tenant_id", "schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_transaction_id_installment_key" ON "invoices"("tenant_id", "transaction_id", "installment");


-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_schedules', 'payment_methods']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
