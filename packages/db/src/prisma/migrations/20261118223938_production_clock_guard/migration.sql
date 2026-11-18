-- Time travel is sandbox-only: a production tenant's clock can never be offset.
ALTER TABLE "tenant_environments"
  ADD CONSTRAINT "tenant_environments_production_clock_check"
  CHECK ("kind" = 'sandbox' OR "clock_offset_ms" = 0);
