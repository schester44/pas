-- Search (⌘K): trigram indexes for the substring/ilike matches, and per-user recently viewed records.
-- Number prefix matches are case-insensitive (ilike), which btree text_pattern_ops can't serve, so
-- numbers get trigram indexes too.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "policies_insured_name_trgm" ON "policies" USING GIN ("insured_name" gin_trgm_ops);
CREATE INDEX "policies_number_trgm" ON "policies" USING GIN ("number" gin_trgm_ops);
CREATE INDEX "submissions_insured_name_trgm" ON "submissions" USING GIN ("insured_name" gin_trgm_ops);
CREATE INDEX "submissions_number_trgm" ON "submissions" USING GIN ("number" gin_trgm_ops);
CREATE INDEX "client_accounts_display_name_trgm" ON "client_accounts" USING GIN ("display_name" gin_trgm_ops);
CREATE INDEX "invoices_number_trgm" ON "invoices" USING GIN ("number" gin_trgm_ops);
CREATE INDEX "invoices_policy_number_trgm" ON "invoices" USING GIN ("policy_number" gin_trgm_ops);
CREATE INDEX "users_name_trgm" ON "users" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "users_email_trgm" ON "users" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);

CREATE TABLE "recent_views" (
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recent_views_pkey" PRIMARY KEY ("tenant_id","user_id","record_type","record_id")
);

CREATE INDEX "recent_views_tenant_id_user_id_viewed_at_idx" ON "recent_views"("tenant_id", "user_id", "viewed_at" DESC);

ALTER TABLE "recent_views" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recent_views"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
