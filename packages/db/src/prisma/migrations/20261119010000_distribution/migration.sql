-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "fein" TEXT,
    "address" JSONB,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "agency_bill_eligible" BOOLEAN NOT NULL DEFAULT false,
    "remittance_days" INTEGER,
    "credit_limit" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producers" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "producer_number" TEXT,
    "npn" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "producers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agency_id" UUID NOT NULL,
    "producer_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producer_licenses" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "producer_id" UUID NOT NULL,
    "npn" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "subdivision" VARCHAR(6) NOT NULL,
    "license_number" TEXT NOT NULL,
    "lines_of_authority" TEXT[],
    "effective_date" DATE NOT NULL,
    "expiration_date" DATE,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "producer_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agency_id" UUID,
    "producer_id" UUID,
    "carrier" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "subdivision" VARCHAR(6) NOT NULL,
    "status" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "terminated_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licensing_requirements" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "lines_of_authority" TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "licensing_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" UUID,
    "country" CHAR(2) NOT NULL,
    "subdivision" VARCHAR(6),
    "business" TEXT,
    "tier" TEXT,
    "rate" DECIMAL(7,4) NOT NULL,
    "effective_date" DATE NOT NULL,
    "expiration_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commission_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "financial_transaction_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "insured_name" TEXT NOT NULL,
    "agency_id" UUID,
    "producer_id" TEXT NOT NULL,
    "schedule_id" UUID,
    "business" TEXT NOT NULL,
    "premium" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_date" DATE NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "policies" ADD COLUMN "agency_id" UUID, ADD COLUMN "agency_name" TEXT;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "agency_id" UUID;

-- CreateIndex
CREATE INDEX "agencies_tenant_id_parent_id_idx" ON "agencies"("tenant_id", "parent_id");

-- CreateIndex
CREATE INDEX "agencies_tenant_id_name_idx" ON "agencies"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "producers_tenant_id_user_id_key" ON "producers"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "producers_tenant_id_email_key" ON "producers"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "producers_tenant_id_npn_idx" ON "producers"("tenant_id", "npn");

-- CreateIndex
CREATE UNIQUE INDEX "agency_memberships_tenant_id_agency_id_producer_id_key" ON "agency_memberships"("tenant_id", "agency_id", "producer_id");

-- CreateIndex
CREATE INDEX "agency_memberships_tenant_id_producer_id_idx" ON "agency_memberships"("tenant_id", "producer_id");

-- CreateIndex
CREATE INDEX "producer_licenses_tenant_id_producer_id_idx" ON "producer_licenses"("tenant_id", "producer_id");

-- CreateIndex
CREATE INDEX "producer_licenses_tenant_id_expiration_date_idx" ON "producer_licenses"("tenant_id", "expiration_date");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_agency_id_idx" ON "appointments"("tenant_id", "agency_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_producer_id_idx" ON "appointments"("tenant_id", "producer_id");

-- CreateIndex
CREATE UNIQUE INDEX "licensing_requirements_tenant_id_product_id_key" ON "licensing_requirements"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "commission_schedules_tenant_id_product_id_idx" ON "commission_schedules"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_tenant_id_financial_transaction_id_key" ON "commissions"("tenant_id", "financial_transaction_id");

-- CreateIndex
CREATE INDEX "commissions_tenant_id_agency_id_recorded_at_idx" ON "commissions"("tenant_id", "agency_id", "recorded_at");

-- CreateIndex
CREATE INDEX "commissions_tenant_id_policy_id_idx" ON "commissions"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "policies_tenant_id_agency_id_created_at_idx" ON "policies"("tenant_id", "agency_id", "created_at");

-- CreateIndex
CREATE INDEX "submissions_tenant_id_agency_id_updated_at_idx" ON "submissions"("tenant_id", "agency_id", "updated_at");

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agencies', 'producers', 'agency_memberships', 'producer_licenses',
    'appointments', 'licensing_requirements', 'commission_schedules', 'commissions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
