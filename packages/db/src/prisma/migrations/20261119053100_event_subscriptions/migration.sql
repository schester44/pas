-- CreateTable
CREATE TABLE "event_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "event_types" TEXT[],
    "filter" TEXT,
    "status" TEXT NOT NULL,
    "disabled_reason" TEXT,
    "secrets" JSONB NOT NULL,
    "secret_hint" TEXT,
    "failing_since" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_events" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "subject_kind" TEXT,
    "subject_id" TEXT,
    "envelope" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_status_code" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_delivery_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "delivery_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "status_code" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "subject_kind" TEXT,
    "subject_id" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_types" TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_subscriptions_tenant_id_status_idx" ON "event_subscriptions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "outbound_events_tenant_id_occurred_at_idx" ON "outbound_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_events_tenant_id_source_event_id_type_key" ON "outbound_events"("tenant_id", "source_event_id", "type");

-- CreateIndex
CREATE INDEX "event_deliveries_tenant_id_subscription_id_created_at_idx" ON "event_deliveries"("tenant_id", "subscription_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_deliveries_subscription_id_event_id_key" ON "event_deliveries"("subscription_id", "event_id");

-- CreateIndex
CREATE INDEX "event_delivery_attempts_tenant_id_delivery_id_attempt_idx" ON "event_delivery_attempts"("tenant_id", "delivery_id", "attempt");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_user_id_event_id_key" ON "notifications"("tenant_id", "user_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenant_id_user_id_key" ON "notification_preferences"("tenant_id", "user_id");


-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['event_subscriptions', 'outbound_events', 'event_deliveries', 'event_delivery_attempts', 'notifications', 'notification_preferences']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
