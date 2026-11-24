-- AlterTable
ALTER TABLE "product_versions" ADD COLUMN "enrichment" JSONB NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION product_versions_published_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') AND (
    NEW.risk_schema IS DISTINCT FROM OLD.risk_schema OR
    NEW.forms IS DISTINCT FROM OLD.forms OR
    NEW.coverages IS DISTINCT FROM OLD.coverages OR
    NEW.availability IS DISTINCT FROM OLD.availability OR
    NEW.lifecycle IS DISTINCT FROM OLD.lifecycle OR
    NEW.documents IS DISTINCT FROM OLD.documents OR
    NEW.rules IS DISTINCT FROM OLD.rules OR
    NEW.rating IS DISTINCT FROM OLD.rating OR
    NEW.enrichment IS DISTINCT FROM OLD.enrichment OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.product_id IS DISTINCT FROM OLD.product_id
  ) THEN
    RAISE EXCEPTION 'published product_versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateTable
CREATE TABLE "enrichment_records" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "submission_id" UUID NOT NULL,
    "product_release_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "prefills" JSONB NOT NULL,
    "discrepancies" JSONB NOT NULL,
    "calls" JSONB NOT NULL,
    "reports" JSONB NOT NULL,
    "missing_reports" JSONB NOT NULL,
    "blocked" JSONB,
    "taken_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrichment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrichment_records_tenant_id_submission_id_stage_taken_at_idx" ON "enrichment_records"("tenant_id", "submission_id", "stage", "taken_at");

ALTER TABLE "enrichment_records" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "enrichment_records"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TRIGGER enrichment_records_immutable BEFORE UPDATE ON "enrichment_records"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
