-- CreateEnum
CREATE TYPE "product_version_status" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED');

-- CreateTable
CREATE TABLE "product_versions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "status" "product_version_status" NOT NULL DEFAULT 'DRAFT',
    "risk_schema" JSONB NOT NULL,
    "forms" JSONB NOT NULL,
    "coverages" JSONB NOT NULL,
    "availability" JSONB NOT NULL,
    "lifecycle" JSONB NOT NULL,
    "based_on_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_releases" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "product_version_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "subdivision" VARCHAR(6),
    "new_business_from" DATE NOT NULL,
    "new_business_to" DATE,
    "renewal_from" DATE NOT NULL,
    "renewal_to" DATE,
    "manifest" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_versions_tenant_id_product_id_status_idx" ON "product_versions"("tenant_id", "product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_versions_product_id_version_key" ON "product_versions"("product_id", "version");

-- CreateIndex
CREATE INDEX "product_releases_tenant_id_product_id_country_subdivision_n_idx" ON "product_releases"("tenant_id", "product_id", "country", "subdivision", "new_business_from");

-- CreateIndex
CREATE INDEX "product_releases_tenant_id_product_id_country_subdivision_r_idx" ON "product_releases"("tenant_id", "product_id", "country", "subdivision", "renewal_from");

-- CreateIndex
CREATE INDEX "product_releases_product_version_id_idx" ON "product_releases"("product_version_id");

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_releases" ADD CONSTRAINT "product_releases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_releases" ADD CONSTRAINT "product_releases_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "product_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security (same pattern as *_tenant_rls).
ALTER TABLE "product_versions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_versions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "product_releases" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_releases"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Published configuration is immutable (CLAUDE.md rule 4), enforced below the application too.
CREATE FUNCTION product_releases_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'product_releases are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_releases_immutable BEFORE UPDATE ON "product_releases"
  FOR EACH ROW EXECUTE FUNCTION product_releases_immutable();

CREATE FUNCTION product_versions_published_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') AND (
    NEW.risk_schema IS DISTINCT FROM OLD.risk_schema OR
    NEW.forms IS DISTINCT FROM OLD.forms OR
    NEW.coverages IS DISTINCT FROM OLD.coverages OR
    NEW.availability IS DISTINCT FROM OLD.availability OR
    NEW.lifecycle IS DISTINCT FROM OLD.lifecycle OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.product_id IS DISTINCT FROM OLD.product_id
  ) THEN
    RAISE EXCEPTION 'published product_versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_versions_published_immutable BEFORE UPDATE ON "product_versions"
  FOR EACH ROW EXECUTE FUNCTION product_versions_published_immutable();
