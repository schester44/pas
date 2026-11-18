import type { ConstructorOptions } from "pg-boss";

export function queueConnectionFromEnv(env: NodeJS.ProcessEnv = process.env): ConstructorOptions {
  const connectionString = env.DATABASE_URL;

  if (!connectionString) throw new Error("DATABASE_URL is required");

  const managesSchema = shouldManageQueueSchema(env);

  return { connectionString, migrate: managesSchema, createSchema: managesSchema };
}

// Deployed api/worker connect as the non-owner `pas_app` role, which can't run DDL;
// `pnpm queues:setup` installs the schema and queues as the owner instead.
export function shouldManageQueueSchema(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PGBOSS_MANAGE_SCHEMA !== "false";
}
