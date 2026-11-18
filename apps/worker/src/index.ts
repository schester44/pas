// Worker composition root: registers queue handlers, scheduled jobs and timers.
import { getPrismaClient, PrismaUnitOfWork } from "@pas/db";
import { asId } from "@pas/kernel";
import { createLogger } from "@pas/observability";
import { makeIssueInvoice, makeRefundCreditNote } from "@pas/billing";
import { PrismaInvoiceRepository } from "@pas/billing/infrastructure";
import {
  makeRecordPolicyEvent,
  makeTermTimers,
  policyCancellationWorkflow,
  policyTermWorkflow,
} from "@pas/policy";
import { PrismaPolicyRepository } from "@pas/policy/infrastructure";
import {
  allQueues,
  domainEventsQueue,
  PgBossOutbox,
  QueueClient,
  queueConnectionFromEnv,
  shouldManageQueueSchema,
} from "@pas/queues";
import { builtinProviders, composeIntegrations } from "@pas/integrations/infrastructure";
import { makeSendPortalInvite } from "@pas/parties";
import { ConsoleMailer } from "@pas/parties/infrastructure";
import { makeQuoteTimers } from "@pas/submissions";
import {
  ClickToSignGateway,
  FakeCardGateway,
  PrismaQuoteRepository,
} from "@pas/submissions/infrastructure";
import { AppHosts, makeGetProfile } from "@pas/tenants";
import { PrismaTenantProfileRepository, TenantClocks } from "@pas/tenants/infrastructure";
import { PostgresWorkflows, workflowConnectionFromEnv } from "@pas/workflows";
import { createDomainEventDispatcher } from "./handlers/domain-events";
import { makeApprovalDemoWorkflow } from "./workflows/approval-demo";
import { makePolicyCancellationWorkflow } from "./workflows/policy-cancellation";
import { makePolicyTermWorkflow } from "./workflows/policy-term";
import { makeQuoteJourneyWorkflow } from "./workflows/quote-journey";

const logger = createLogger("worker");
const prisma = getPrismaClient();
const queues = new QueueClient(queueConnectionFromEnv(), logger);
const uow = new PrismaUnitOfWork(prisma);
const outbox = new PgBossOutbox(queues);
const clocks = new TenantClocks(prisma);
await clocks.start();

if (shouldManageQueueSchema()) await queues.ensureQueues(allQueues);

const quoteTimers = makeQuoteTimers({ uow, outbox, quotes: new PrismaQuoteRepository(), clocks });

const policies = new PrismaPolicyRepository();
const invoices = new PrismaInvoiceRepository();

const termTimers = makeTermTimers({
  uow,
  outbox,
  policies,
  invoices: { issue: makeIssueInvoice({ invoices, clocks }) },
  clocks,
});

const recordPolicyEvent = makeRecordPolicyEvent({ policies, clocks });

const integrations = composeIntegrations({
  prisma,
  uow,
  outbox,
  clocks,
  environments: {
    isSandbox: async (tenantId) => {
      await clocks.refresh(tenantId);

      return clocks.isSandbox(tenantId);
    },
  },
  builtins: builtinProviders({
    payments: new FakeCardGateway(clocks),
    esign: new ClickToSignGateway(),
    email: new ConsoleMailer(logger),
  }),
  notices: {
    record: (tx, ctx, input) =>
      recordPolicyEvent(tx, ctx, {
        ...input,
        type: "notice_mailed",
        actor: { type: "system", name: "Print and mail" },
      }),
  },
  secretKey: process.env.INTEGRATIONS_SECRET_KEY,
  publicUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
});

const refundCreditNote = makeRefundCreditNote({
  uow,
  invoices,
  gateway: integrations.resolver.port("payments"),
  timeline: { record: (tx, ctx, entry) => recordPolicyEvent(tx, ctx, entry) },
  clocks,
});

const getProfile = makeGetProfile({
  uow,
  profiles: new PrismaTenantProfileRepository(),
  hosts: new AppHosts(process.env.APP_ORIGIN ?? "http://localhost:5174"),
});

const sendPortalInvite = makeSendPortalInvite({
  mailers: integrations.resolver.port("email"),
  links: {
    signIn: async (ctx, { email }) => {
      const profile = await getProfile(ctx);
      const url = new URL("/login", profile.appUrls[0]);
      url.searchParams.set("as", "client");
      url.searchParams.set("email", email);

      return { url: url.toString(), brand: profile.displayName };
    },
  },
});

const systemContext = (tenantId: string) => ({
  tenantId: asId<"Tenant">(tenantId),
  actor: { type: "system" as const, process: "worker" },
});

const workflows = new PostgresWorkflows({
  ...workflowConnectionFromEnv(),
  logger,
  tenantTime: clocks,
  workflows: [
    makeApprovalDemoWorkflow(logger),
    makeQuoteJourneyWorkflow({ timers: quoteTimers, logger }),
    makePolicyTermWorkflow({ timers: termTimers }),
    makePolicyCancellationWorkflow({ timers: termTimers }),
  ],
});

const workerContext = (tenantId: string) => ({
  tenantId: asId<"Tenant">(tenantId),
  actor: { type: "system" as const, process: "worker" },
});

const dispatch = createDomainEventDispatcher(
  {
    "policy.cancellation_scheduled": [
      async (event) => {
        const { termId, transactionId } = event.payload as {
          termId: string;
          transactionId: string;
        };

        await workflows.start(
          workerContext(event.tenantId),
          policyCancellationWorkflow,
          { termId, transactionId },
          { idempotencyKey: `policy.cancellation:${transactionId}` },
        );
      },
    ],
    "policy.credit_note_issued": [
      async (event) => {
        const { invoiceId } = event.payload as { invoiceId: string };

        await refundCreditNote(workerContext(event.tenantId), { invoiceId });
      },
    ],
    "policy.transaction_issued": [
      async (event) => {
        const { type, termId, transactionId, status } = event.payload as {
          type: string;
          termId: string;
          transactionId: string;
          status: string;
        };

        if (status !== "pending_effective" || type === "NEW_BUSINESS") return;

        await workflows.start(
          workerContext(event.tenantId),
          policyTermWorkflow,
          { termId },
          {
            idempotencyKey: `policy.term:${termId}:${transactionId}`,
          },
        );
      },
    ],
    "integrations.install_changed": [
      async (event) => integrations.resolver.invalidate(event.tenantId),
    ],
    "catalog.product_created": [async (event) => logger.info({ event }, "product created")],
    "parties.client_invited": [
      async (event) => {
        const invite = event.payload as { email: string; name: string; policyNumber: string };

        await sendPortalInvite(systemContext(event.tenantId), invite);
      },
    ],
    "policy.change_requested": [
      async (event) => logger.info({ event }, "change requested; route to the producer"),
    ],
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
  clocks.stop();
  await queues.stop();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
