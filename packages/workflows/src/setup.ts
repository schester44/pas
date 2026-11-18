import { createLogger } from "@pas/observability";
import { PgWorkflows } from "./pg-workflows";

const connectionString = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL_OWNER or DATABASE_URL is required");

const logger = createLogger("workflows-setup");
const workflows = new PgWorkflows({ connectionString, manageSchema: true, logger, workflows: [] });
await workflows.open();
await workflows.close();
logger.info("workflow schema and queues are ready");
