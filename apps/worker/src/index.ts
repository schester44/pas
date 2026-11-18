// Worker composition root: registers queue handlers, scheduled jobs and timers.
import { getPrismaClient } from "@pas/db";
import { createLogger } from "@pas/observability";
import { allQueues, domainEventsQueue, QueueClient } from "@pas/queues";
import { env } from "./env";
import { createDomainEventDispatcher } from "./handlers/domain-events";

const logger = createLogger("worker");
const prisma = getPrismaClient();
const queues = new QueueClient({ connectionString: env.DATABASE_URL }, logger);

await queues.ensureQueues(allQueues);

const dispatch = createDomainEventDispatcher(
  {
    "catalog.product_created": [async (event) => logger.info({ event }, "product created")],
  },
  logger,
);

await queues.work(domainEventsQueue, dispatch);

logger.info("worker started");

const shutdown = async () => {
  logger.info("worker stopping");
  await queues.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
