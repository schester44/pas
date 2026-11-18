-- AlterTable
ALTER TABLE "product_versions" ADD COLUMN     "documents" JSONB NOT NULL DEFAULT '{"templates": [], "clauses": [], "schedule": []}';

-- CreateTable
CREATE TABLE "form_editions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "form_number" TEXT NOT NULL,
    "edition" CHAR(7) NOT NULL,
    "title" TEXT NOT NULL,
    "jurisdictions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "carrier" TEXT,
    "storage_key" TEXT NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "page_count" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "form_editions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_editions_tenant_id_created_at_idx" ON "form_editions"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "form_editions_tenant_id_form_number_edition_key" ON "form_editions"("tenant_id", "form_number", "edition");

-- Row-level security (same pattern as *_tenant_rls).
ALTER TABLE "form_editions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "form_editions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- A form edition is filed wording: a correction is a new edition, never an edit.
CREATE FUNCTION form_editions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'form_editions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER form_editions_immutable BEFORE UPDATE ON "form_editions"
  FOR EACH ROW EXECUTE FUNCTION form_editions_immutable();

CREATE OR REPLACE FUNCTION product_versions_published_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') AND (
    NEW.risk_schema IS DISTINCT FROM OLD.risk_schema OR
    NEW.forms IS DISTINCT FROM OLD.forms OR
    NEW.coverages IS DISTINCT FROM OLD.coverages OR
    NEW.availability IS DISTINCT FROM OLD.availability OR
    NEW.lifecycle IS DISTINCT FROM OLD.lifecycle OR
    NEW.documents IS DISTINCT FROM OLD.documents OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.product_id IS DISTINCT FROM OLD.product_id
  ) THEN
    RAISE EXCEPTION 'published product_versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
