-- CreateTable
CREATE TABLE "quote_client_requests" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "quote_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "submission_number" TEXT NOT NULL,
    "producer_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sent_by_user_id" TEXT,
    "sent_by_name" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "opened_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quote_client_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_client_requests_tenant_id_quote_id_created_at_idx" ON "quote_client_requests"("tenant_id", "quote_id", "created_at");

ALTER TABLE "quote_client_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quote_client_requests"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
