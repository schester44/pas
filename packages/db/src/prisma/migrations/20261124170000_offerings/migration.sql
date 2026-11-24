-- CreateEnum
CREATE TYPE "offering_status" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "offerings" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product_ids" UUID[],
    "selection" TEXT NOT NULL,
    "status" "offering_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "offerings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offerings_tenant_id_key_key" ON "offerings"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "offerings_tenant_id_status_idx" ON "offerings"("tenant_id", "status");

ALTER TABLE "offerings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "offerings"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- AlterTable: submissions started before offerings take their entry on the product's own release.
ALTER TABLE "submissions" ADD COLUMN "intake_release_id" UUID,
ADD COLUMN "offering_id" UUID,
ADD COLUMN "selection" TEXT,
ADD COLUMN "candidates" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "options" JSONB NOT NULL DEFAULT '[]';

UPDATE "submissions" SET "intake_release_id" = "product_release_id";

ALTER TABLE "submissions" ALTER COLUMN "intake_release_id" SET NOT NULL;
