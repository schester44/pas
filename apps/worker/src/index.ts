// Worker composition root: registers queue handlers, scheduled jobs and timers.
import { getPrismaClient, PrismaUnitOfWork } from "@pas/db";
import { asId, systemClock } from "@pas/kernel";
import { createLogger } from "@pas/observability";
import { makeTermTimers, policyTermWorkflow } from "@pas/policy";
import { PrismaPolicyRepository } from "@pas/policy/infrastructure";
import {
  allQueues,
  domainEventsQueue,
  PgBossOutbox,
  QueueClient,
  queueConnectionFromEnv,
  shouldManageQueueSchema,
} from "@pas/queues";
import { makeQuoteTimers } from "@pas/submissions";
import { PrismaQuoteRepository } from "@pas/submissions/infrastructure";
import { PostgresWorkflows, workflowConnectionFromEnv } from "@pas/workflows";
import { createDomainEventDispatcher } from "./handlers/domain-events";
import { makeApprovalDemoWorkflow } from "./workflows/approval-demo";
import { makePolicyTermWorkflow } from "./workflows/policy-term";
import { makeQuoteJourneyWorkflow } from "./workflows/quote-journey";

const logger = createLogger("worker");
const prisma = getPrismaClient();
const queues = new QueueClient(queueConnectionFromEnv(), logger);
const uow = new PrismaUnitOfWork(prisma);
const outbox = new PgBossOutbox(queues);
const clock = systemClock;

if (shouldManageQueueSchema()) await queues.ensureQueues(allQueues);

const quoteTimers = makeQuoteTimers({ uow, outbox, quotes: new PrismaQuoteRepository(), clock });

const termTimers = makeTermTimers({
  uow,
  outbox,
  policies: new PrismaPolicyRepository(),
  clock,
});

const workflows = new PostgresWorkflows({
  ...workflowConnectionFromEnv(),
  logger,
  workflows: [
    makeApprovalDemoWorkflow(logger),
    makeQuoteJourneyWorkflow({ timers: quoteTimers, logger }),
    makePolicyTermWorkflow({ timers: termTimers }),
  ],
});

const dispatch = createDomainEventDispatcher(
  {
    "catalog.product_created": [async (event) => logger.info({ event }, "product created")],
    "policy.term_bound": [
      async (event) => {
        const { termId } = event.payload as { termId: string };

        await workflows.start(
          { tenantId: asId(event.tenantId), actor: { type: "system", process: "worker" } },
          policyTermWorkflow,
          { termId },
          { idempotencyKey: `policy.term:${termId}` },
        );
      },
    ],
  },
  logger,
);

await queues.work(domainEventsQueue, dispatch);
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
