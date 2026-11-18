-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('DRAFT', 'SUBMITTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "product_release_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "product_version" TEXT NOT NULL,
    "form_key" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "subdivision" VARCHAR(6),
    "effective_date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "producer_id" TEXT NOT NULL,
    "producer_name" TEXT NOT NULL,
    "insured_name" TEXT,
    "risk_data" JSONB NOT NULL,
    "status" "submission_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_sequences" (
    "tenant_id" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "submission_sequences_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "submissions_tenant_id_updated_at_idx" ON "submissions"("tenant_id", "updated_at");

-- CreateIndex
CREATE INDEX "submissions_tenant_id_producer_id_updated_at_idx" ON "submissions"("tenant_id", "producer_id", "updated_at");

-- CreateIndex
CREATE INDEX "submissions_tenant_id_status_updated_at_idx" ON "submissions"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_tenant_id_number_key" ON "submissions"("tenant_id", "number");

-- Row-level security (same pattern as *_tenant_rls).
ALTER TABLE "submissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "submissions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "submission_sequences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "submission_sequences"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- The pin is the contract: a submission never moves to another release (CLAUDE.md rule 5).
CREATE FUNCTION submissions_pin_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.product_release_id IS DISTINCT FROM OLD.product_release_id OR
     NEW.form_key IS DISTINCT FROM OLD.form_key OR
     NEW.number IS DISTINCT FROM OLD.number OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'a submission''s release pin and number are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submissions_pin_immutable BEFORE UPDATE ON "submissions"
  FOR EACH ROW EXECUTE FUNCTION submissions_pin_immutable();
