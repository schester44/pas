-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('enabled', 'disabled', 'error');

-- CreateEnum
CREATE TYPE "integration_environment" AS ENUM ('test', 'live');

-- CreateTable
CREATE TABLE "integration_installs" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "integration_status" NOT NULL,
    "environment" "integration_environment" NOT NULL,
    "config" JSONB NOT NULL,
    "secrets" JSONB NOT NULL,
    "secret_hints" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMPTZ(6),
    "last_check_ok" BOOLEAN,
    "last_check_detail" TEXT,
    "enabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "install_id" UUID,
    "provider_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "external_id" TEXT,
    "data" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_pieces" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "install_id" UUID,
    "provider_id" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "reference" JSONB NOT NULL,
    "mail_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tracking_number" TEXT,
    "tracking" JSONB NOT NULL,
    "proof" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mail_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_installs_tenant_id_category_status_idx" ON "integration_installs"("tenant_id", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_installs_tenant_id_provider_id_key" ON "integration_installs"("tenant_id", "provider_id");

-- CreateIndex
CREATE INDEX "integration_events_tenant_id_provider_id_occurred_at_idx" ON "integration_events"("tenant_id", "provider_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_tenant_id_provider_id_external_id_key" ON "integration_events"("tenant_id", "provider_id", "external_id");

-- CreateIndex
CREATE INDEX "mail_pieces_tenant_id_created_at_idx" ON "mail_pieces"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mail_pieces_tenant_id_provider_id_provider_ref_key" ON "mail_pieces"("tenant_id", "provider_id", "provider_ref");

-- Row-level security (same pattern as *_tenant_rls). Webhooks arrive without a tenant, so the
-- install row is readable under platform_read to find its tenant first.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_installs', 'integration_events', 'mail_pieces']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;

CREATE POLICY platform_read ON "integration_installs" FOR SELECT
  USING (current_setting('app.platform_read', true) = 'on');
