import { createLogger } from "@pas/observability";
import { QueueClient } from "./client";
import { allQueues } from "./queues/index";

const connectionString = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL_OWNER or DATABASE_URL is required");

const logger = createLogger("queues-setup");
const queues = new QueueClient({ connectionString, migrate: true, createSchema: true }, logger);
await queues.ensureQueues(allQueues);
await queues.stop();
logger.info({ queues: allQueues.map((queue) => queue.name) }, "queue schema and queues are ready");
