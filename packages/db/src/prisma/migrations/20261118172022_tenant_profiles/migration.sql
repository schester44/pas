-- CreateTable
CREATE TABLE "tenant_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_color" TEXT NOT NULL,
    "logo_url" TEXT,
    "app_subdomain" TEXT NOT NULL,
    "support_email" TEXT,
    "support_phone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_profiles_tenant_id_key" ON "tenant_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_profiles_app_subdomain_key" ON "tenant_profiles"("app_subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_hostname_key" ON "tenant_domains"("hostname");

-- CreateIndex
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains"("tenant_id");

-- Row-level security (same pattern as *_tenant_rls). Tenant-scoped units of work see only their
-- own rows.
ALTER TABLE "tenant_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_profiles"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_domains"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Platform-level reads. Host resolution (apps/app, before any tenant is known) and the platform
-- tenants list must read across tenants. They run in a transaction that sets
-- `app.platform_read = 'on'` (PrismaTenantDirectory). Read-only: no writes are allowed through it.
CREATE POLICY platform_read ON "tenant_profiles" FOR SELECT
  USING (current_setting('app.platform_read', true) = 'on');
CREATE POLICY platform_read ON "tenant_domains" FOR SELECT
  USING (current_setting('app.platform_read', true) = 'on');
