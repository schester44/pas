-- CreateEnum
CREATE TYPE "tenant_environment_kind" AS ENUM ('production', 'sandbox');

-- CreateTable
CREATE TABLE "tenant_environments" (
    "tenant_id" TEXT NOT NULL,
    "kind" "tenant_environment_kind" NOT NULL,
    "parent_tenant_id" TEXT,
    "clock_offset_ms" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_environments_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "sandbox_time_advances" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_time" TIMESTAMPTZ(6) NOT NULL,
    "to_time" TIMESTAMPTZ(6) NOT NULL,
    "actor" JSONB NOT NULL,
    "fired" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sandbox_time_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_environments_parent_tenant_id_idx" ON "tenant_environments"("parent_tenant_id");

-- CreateIndex
CREATE INDEX "sandbox_time_advances_tenant_id_created_at_idx" ON "sandbox_time_advances"("tenant_id", "created_at");

-- Row-level security (same pattern as *_tenant_rls). A production tenant also sees its sandboxes'
-- environment rows so it can list and enter them.
ALTER TABLE "tenant_environments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_environments"
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR parent_tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    OR parent_tenant_id = current_setting('app.tenant_id', true)
  );
CREATE POLICY platform_read ON "tenant_environments" FOR SELECT
  USING (current_setting('app.platform_read', true) = 'on');

ALTER TABLE "sandbox_time_advances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sandbox_time_advances"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
