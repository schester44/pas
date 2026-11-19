-- CreateTable
CREATE TABLE "address_records" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_address_id" TEXT,
    "status" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "plus4" TEXT,
    "country" CHAR(2) NOT NULL,
    "components" JSONB NOT NULL,
    "county_name" TEXT,
    "county_fips" VARCHAR(5),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "geocode_precision" TEXT,
    "geocode_source" TEXT,
    "dpv_match" CHAR(1),
    "vacant" BOOLEAN,
    "deliverable" BOOLEAN,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "address_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address_usages" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "address_id" UUID NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_label" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "product_id" TEXT,
    "producer_id" TEXT,
    "producer_name" TEXT,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "address_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "address_records_tenant_id_key_key" ON "address_records"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "address_records_tenant_id_text_key_idx" ON "address_records"("tenant_id", "text_key");

-- CreateIndex
CREATE UNIQUE INDEX "address_usages_tenant_id_subject_kind_subject_id_role_addre_key" ON "address_usages"("tenant_id", "subject_kind", "subject_id", "role", "address_id");

-- CreateIndex
CREATE INDEX "address_usages_tenant_id_address_id_active_idx" ON "address_usages"("tenant_id", "address_id", "active");

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['address_records', 'address_usages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
