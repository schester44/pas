-- CreateTable
CREATE TABLE "extensions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "latest_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_versions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "extension_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "manifest" JSONB NOT NULL,
    "tests" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "test_report" JSONB NOT NULL,
    "note" TEXT,
    "published_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "extension_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_secrets" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "extension_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sealed" JSONB NOT NULL,
    "hint" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "extension_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "extension_id" UUID NOT NULL,
    "extension_version_id" UUID NOT NULL,
    "event_types" JSONB NOT NULL,
    "condition" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "extension_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_runs" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "extension_id" UUID NOT NULL,
    "extension_version_id" UUID,
    "version" INTEGER,
    "point" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "network" JSONB NOT NULL,
    "logs" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "extension_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extensions_tenant_id_status_idx" ON "extensions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "extensions_tenant_id_key_key" ON "extensions"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "extension_versions_tenant_id_extension_id_idx" ON "extension_versions"("tenant_id", "extension_id");

-- CreateIndex
CREATE UNIQUE INDEX "extension_versions_tenant_id_extension_id_version_key" ON "extension_versions"("tenant_id", "extension_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "extension_secrets_tenant_id_extension_id_name_key" ON "extension_secrets"("tenant_id", "extension_id", "name");

-- CreateIndex
CREATE INDEX "extension_subscriptions_tenant_id_enabled_idx" ON "extension_subscriptions"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "extension_subscriptions_tenant_id_extension_id_idx" ON "extension_subscriptions"("tenant_id", "extension_id");

-- CreateIndex
CREATE INDEX "extension_runs_tenant_id_created_at_idx" ON "extension_runs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "extension_runs_tenant_id_extension_id_created_at_idx" ON "extension_runs"("tenant_id", "extension_id", "created_at");

-- CreateIndex
CREATE INDEX "extension_runs_tenant_id_subject_type_subject_id_idx" ON "extension_runs"("tenant_id", "subject_type", "subject_id");


-- Published extension versions are insert-only: changes go into a new version.
CREATE FUNCTION extension_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Published extension version % is immutable', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER extension_versions_immutable
  BEFORE UPDATE ON "extension_versions"
  FOR EACH ROW EXECUTE FUNCTION extension_versions_immutable();

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['extensions', 'extension_versions', 'extension_secrets', 'extension_subscriptions', 'extension_runs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
