-- CreateTable
CREATE TABLE "carriers" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "naic" TEXT,
    "am_best" TEXT,
    "admitted" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "extension_key" TEXT,
    "active_environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_connections" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "auth" JSONB NOT NULL,
    "secrets" JSONB NOT NULL,
    "secret_hints" JSONB NOT NULL,
    "callback" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_connector_versions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "content_hash" CHAR(64),
    "test_report" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "carrier_connector_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_fixtures" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "exchanges" JSONB NOT NULL,
    "callbacks" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_flow_runs" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" UUID NOT NULL,
    "connection_id" UUID,
    "connector_version_id" UUID,
    "connector_version" INTEGER,
    "capability" TEXT NOT NULL,
    "subject" JSONB NOT NULL,
    "mode" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "workflow_run_id" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "carrier_flow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_exchanges" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "flow_run_id" UUID NOT NULL,
    "exec_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_callbacks" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" UUID NOT NULL,
    "correlation" TEXT NOT NULL,
    "flow_run_id" UUID,
    "workflow_run_id" TEXT,
    "event" TEXT,
    "payload" JSONB,
    "received_at" TIMESTAMPTZ(6),
    "signalled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_policy_links" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "quote_id" UUID,
    "carrier_policy_number" TEXT,
    "carrier_reference" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_policy_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_feeds" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" JSONB NOT NULL,
    "schedule" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_feed_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "feed_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT,
    "records" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "detail" TEXT,
    "delivered_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carrier_feed_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carriers_tenant_id_status_idx" ON "carriers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "carriers_tenant_id_key_key" ON "carriers"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_connections_tenant_id_carrier_id_environment_key" ON "carrier_connections"("tenant_id", "carrier_id", "environment");

-- CreateIndex
CREATE INDEX "carrier_connector_versions_tenant_id_carrier_id_status_idx" ON "carrier_connector_versions"("tenant_id", "carrier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_connector_versions_tenant_id_carrier_id_version_key" ON "carrier_connector_versions"("tenant_id", "carrier_id", "version");

-- CreateIndex
CREATE INDEX "carrier_fixtures_tenant_id_carrier_id_capability_idx" ON "carrier_fixtures"("tenant_id", "carrier_id", "capability");

-- CreateIndex
CREATE INDEX "carrier_flow_runs_tenant_id_carrier_id_started_at_idx" ON "carrier_flow_runs"("tenant_id", "carrier_id", "started_at");

-- CreateIndex
CREATE INDEX "carrier_exchanges_tenant_id_flow_run_id_occurred_at_idx" ON "carrier_exchanges"("tenant_id", "flow_run_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_exchanges_flow_run_id_exec_id_key" ON "carrier_exchanges"("flow_run_id", "exec_id");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_callbacks_tenant_id_connection_id_correlation_key" ON "carrier_callbacks"("tenant_id", "connection_id", "correlation");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_policy_links_tenant_id_policy_id_key" ON "carrier_policy_links"("tenant_id", "policy_id");

-- CreateIndex
CREATE INDEX "carrier_feeds_tenant_id_carrier_id_idx" ON "carrier_feeds"("tenant_id", "carrier_id");

-- CreateIndex
CREATE INDEX "carrier_feed_deliveries_tenant_id_feed_id_delivered_at_idx" ON "carrier_feed_deliveries"("tenant_id", "feed_id", "delivered_at");


-- Published connector versions are immutable; changes go into a new version.
CREATE FUNCTION carrier_connector_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' AND (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.version IS DISTINCT FROM OLD.version OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
    RAISE EXCEPTION 'Published connector version % is immutable', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER carrier_connector_versions_immutable
  BEFORE UPDATE ON "carrier_connector_versions"
  FOR EACH ROW EXECUTE FUNCTION carrier_connector_versions_immutable();

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['carriers', 'carrier_connections', 'carrier_connector_versions', 'carrier_fixtures', 'carrier_flow_runs', 'carrier_exchanges', 'carrier_callbacks', 'carrier_policy_links', 'carrier_feeds', 'carrier_feed_deliveries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
