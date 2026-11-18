-- CreateTable
CREATE TABLE "client_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "business_name" TEXT,
    "emails" JSONB NOT NULL,
    "phones" JSONB NOT NULL,
    "mailing_address" JSONB,
    "name_key" TEXT NOT NULL,
    "email_keys" TEXT[],
    "phone_keys" TEXT[],
    "address_key" TEXT,
    "status" TEXT NOT NULL,
    "merged_into_id" UUID,
    "invited_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_parties" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_number" TEXT NOT NULL,
    "client_account_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_users" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_account_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_claim_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "policy_number" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_claim_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requested_by" JSONB NOT NULL,
    "producer_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_accounts_tenant_id_status_name_key_idx" ON "client_accounts"("tenant_id", "status", "name_key");

-- CreateIndex
CREATE INDEX "client_accounts_tenant_id_created_at_idx" ON "client_accounts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "client_accounts_email_keys_idx" ON "client_accounts" USING GIN ("email_keys");

-- CreateIndex
CREATE INDEX "policy_parties_tenant_id_client_account_id_idx" ON "policy_parties"("tenant_id", "client_account_id");

-- CreateIndex
CREATE INDEX "policy_parties_tenant_id_policy_number_idx" ON "policy_parties"("tenant_id", "policy_number");

-- CreateIndex
CREATE UNIQUE INDEX "policy_parties_tenant_id_policy_id_client_account_id_role_key" ON "policy_parties"("tenant_id", "policy_id", "client_account_id", "role");

-- CreateIndex
CREATE INDEX "client_users_tenant_id_client_account_id_idx" ON "client_users"("tenant_id", "client_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_users_tenant_id_user_id_client_account_id_key" ON "client_users"("tenant_id", "user_id", "client_account_id");

-- CreateIndex
CREATE INDEX "client_claim_attempts_tenant_id_user_id_attempted_at_idx" ON "client_claim_attempts"("tenant_id", "user_id", "attempted_at");

-- CreateIndex
CREATE INDEX "change_requests_tenant_id_policy_id_created_at_idx" ON "change_requests"("tenant_id", "policy_id", "created_at");

-- CreateIndex
CREATE INDEX "change_requests_tenant_id_producer_id_status_idx" ON "change_requests"("tenant_id", "producer_id", "status");

-- Row-level security (same pattern as *_tenant_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_accounts', 'policy_parties', 'client_users',
    'client_claim_attempts', 'change_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
