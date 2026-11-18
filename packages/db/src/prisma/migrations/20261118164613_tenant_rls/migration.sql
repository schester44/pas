-- Row-level security as defense in depth for tenant isolation.
-- PrismaUnitOfWork sets `app.tenant_id` transaction-locally. Application-level scoping remains
-- the primary control.
--
-- NOTE: Postgres superusers and table owners bypass RLS. In deployed environments the API and
-- worker must connect as a non-owner role (e.g. `pas_app`) for these policies to take effect.
-- Every new tenant-owned table gets the same two statements.

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
