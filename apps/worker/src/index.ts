// Worker composition root: registers queue handlers, scheduled jobs and timers.
import { getPrismaClient } from "@pas/db";
import { createLogger } from "@pas/observability";
import {
  allQueues,
  domainEventsQueue,
  QueueClient,
  queueConnectionFromEnv,
  shouldManageQueueSchema,
} from "@pas/queues";
import { PgWorkflows, workflowConnectionFromEnv } from "@pas/workflows";
import { createDomainEventDispatcher } from "./handlers/domain-events";
import { makeApprovalDemoWorkflow } from "./workflows/approval-demo";

const logger = createLogger("worker");
const prisma = getPrismaClient();
const queues = new QueueClient(queueConnectionFromEnv(), logger);

if (shouldManageQueueSchema()) await queues.ensureQueues(allQueues);

const dispatch = createDomainEventDispatcher(
  {
    "catalog.product_created": [async (event) => logger.info({ event }, "product created")],
  },
  logger,
);

await queues.work(domainEventsQueue, dispatch);

const workflows = new PgWorkflows({
  ...workflowConnectionFromEnv(),
  logger,
  workflows: [makeApprovalDemoWorkflow(logger)],
});

await workflows.open();

logger.info("worker started");

const shutdown = async () => {
  logger.info("worker stopping");
  await workflows.close();
  await queues.stop();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
