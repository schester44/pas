-- AlterTable
ALTER TABLE "product_versions" ADD COLUMN     "rating" JSONB,
ADD COLUMN     "rules" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "rater_workbooks" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rater_workbooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rater_workbooks_tenant_id_created_at_idx" ON "rater_workbooks"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rater_workbooks_tenant_id_content_sha256_key" ON "rater_workbooks"("tenant_id", "content_sha256");

-- Row-level security (same pattern as *_tenant_rls).
ALTER TABLE "rater_workbooks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rater_workbooks"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Published versions pin a workbook by id, so its bytes and report can never change.
CREATE FUNCTION rater_workbooks_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'rater_workbooks are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rater_workbooks_immutable BEFORE UPDATE ON "rater_workbooks"
  FOR EACH ROW EXECUTE FUNCTION rater_workbooks_immutable();

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
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.product_id IS DISTINCT FROM OLD.product_id
  ) THEN
    RAISE EXCEPTION 'published product_versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
