export interface WorkflowConnection {
  connectionString: string;
  manageSchema: boolean;
}

// Workflows ride on pg-boss, so they follow the same switch: deployed api/worker run as `pas_app`
// (no DDL) and `pnpm workflows:setup` installs the schema as the owner.
export function workflowConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkflowConnection {
  const connectionString = env.DATABASE_URL;

  if (!connectionString) throw new Error("DATABASE_URL is required");

  return { connectionString, manageSchema: env.PGBOSS_MANAGE_SCHEMA !== "false" };
}
