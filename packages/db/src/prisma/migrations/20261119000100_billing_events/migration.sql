-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amount_written_off" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "method_kind",
DROP COLUMN "reference";

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "invoice_id" UUID,
    "policy_id" UUID,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_events_tenant_id_policy_id_occurred_at_idx" ON "billing_events"("tenant_id", "policy_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_tenant_id_source_event_id_key" ON "billing_events"("tenant_id", "source", "event_id");


ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "billing_events"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
