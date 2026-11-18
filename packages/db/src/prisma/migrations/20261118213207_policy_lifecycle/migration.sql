-- AlterEnum
ALTER TYPE "policy_term_status" ADD VALUE 'PENDING_CANCELLATION';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'payment';

-- AlterTable
ALTER TABLE "policy_terms" ADD COLUMN     "cancellation" JSONB;

-- AlterTable: transactions now live through quoted, pending and scheduled before issue
ALTER TABLE "policy_transactions" ADD COLUMN     "base_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "created_at" TIMESTAMPTZ(6),
ADD COLUMN     "created_by" JSONB,
ADD COLUMN     "details" JSONB,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6),
ALTER COLUMN "issued_at" DROP NOT NULL;

-- Only issued transactions are immutable (CLAUDE.md rule 6); open ones move through their states.
DROP TRIGGER policy_transactions_immutable ON "policy_transactions";

UPDATE "policy_transactions" SET "created_at" = "issued_at", "updated_at" = "issued_at", "base_version" = 0;

ALTER TABLE "policy_transactions" ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

CREATE FUNCTION policy_transactions_issued_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'issued' THEN
    RAISE EXCEPTION 'issued policy_transactions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_transactions_issued_immutable BEFORE UPDATE OR DELETE ON "policy_transactions"
  FOR EACH ROW EXECUTE FUNCTION policy_transactions_issued_immutable();

-- CreateIndex
CREATE INDEX "policy_transactions_tenant_id_status_effective_date_idx" ON "policy_transactions"("tenant_id", "status", "effective_date");
