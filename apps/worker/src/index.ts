// Worker composition root: registers queue handlers, scheduled jobs and timers.
import { getPrismaClient, PrismaUnitOfWork } from "@pas/db";
import { asId } from "@pas/kernel";
import { createLogger } from "@pas/observability";
import {
  billingEventFrom,
  type InboundBillingEvent,
  installmentWorkflow,
  makeApplyBillingEvent,
  makeInstallmentTimers,
  makeIssueInvoice,
  makeRefundCreditNote,
  pastDueOf,
} from "@pas/billing";
import {
  PrismaAgencyStatementRepository,
  PrismaBillingEventLog,
  PrismaBillingScheduleRepository,
  PrismaInvoiceRepository,
  PrismaMortgageeBillRepository,
} from "@pas/billing/infrastructure";
import {
  makeCureNonpayment,
  makeGetTransactionFinancials,
  makeGetTransactionFacts,
  makeRecordPolicyEvent,
  makeStartNonpayment,
  makeTermTimers,
  policyCancellationWorkflow,
  policyTermWorkflow,
} from "@pas/policy";
import { createStorageFromEnv } from "@pas/storage";
import { PrismaPolicyRepository } from "@pas/policy/infrastructure";
import { makeRecordCommissions } from "@pas/distribution";
import {
  PrismaAgencyRepository,
  PrismaCommissionRepository,
} from "@pas/distribution/infrastructure";
import {
  allQueues,
  domainEventsQueue,
  eventDeliveriesQueue,
  PgBossOutbox,
  QueueClient,
  queueConnectionFromEnv,
  shouldManageQueueSchema,
} from "@pas/queues";
import { filingWorkflow, obligationWorkflow } from "@pas/compliance";
import { composeCompliance } from "@pas/compliance/infrastructure";
import {
  builtinProviders,
  composeIntegrations,
  inspectionProviders,
  filingChannelsFrom,
} from "@pas/integrations/infrastructure";
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
import { composeWorkerBillingMethods, withHandlers } from "./billing-methods";
import { composeWorkerEvents } from "./events";
import { createDomainEventDispatcher } from "./handlers/domain-events";
import { composePolicyServices } from "./policy-services";
import { makeApprovalDemoWorkflow } from "./workflows/approval-demo";
import { makeFilingWorkflow, makeObligationWorkflow } from "./workflows/compliance";
import { makeInstallmentWorkflow } from "./workflows/billing-installment";
import { makePolicyCancellationWorkflow } from "./workflows/policy-cancellation";
import { makePolicyTermWorkflow } from "./workflows/policy-term";
import { makeQuoteJourneyWorkflow } from "./workflows/quote-journey";
import { composeWorkerUnderwriting } from "./underwriting";

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
const transactionFinancials = makeGetTransactionFinancials({ uow, policies });

const recordCommissions = makeRecordCommissions({
  uow,
  agencies: new PrismaAgencyRepository(),
  commissions: new PrismaCommissionRepository(),
  clocks,
  financials: { transaction: transactionFinancials },
});

const invoices = new PrismaInvoiceRepository();
const schedules = new PrismaBillingScheduleRepository();
const recordPolicyEvent = makeRecordPolicyEvent({ policies, clocks, outbox });

const mortgageeBills = new PrismaMortgageeBillRepository();

const billingEvents = {
  invoices,
  events: new PrismaBillingEventLog(),
  timeline: { record: recordPolicyEvent },
  outbox,
  clocks,
  statements: new PrismaAgencyStatementRepository(),
  mortgageeBills,
};

const applyBillingEvent = makeApplyBillingEvent({ ...billingEvents, uow });
const issueInvoice = makeIssueInvoice({ ...billingEvents, schedules, mortgageeBills });

const termTimers = makeTermTimers({
  uow,
  outbox,
  policies,
  invoices: { issue: issueInvoice },
  clocks,
});

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
  builtins: [
    ...builtinProviders({
      payments: new FakeCardGateway(clocks),
      esign: new ClickToSignGateway(),
      email: new ConsoleMailer(logger),
    }),
    ...inspectionProviders(clocks),
  ],
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
  applyEvent: applyBillingEvent,
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

const mailers = integrations.resolver.port("email");

const policyServices = composePolicyServices({
  prisma,
  uow,
  outbox,
  clocks,
  storage: createStorageFromEnv(),
  policies,
  invoices: { issue: issueInvoice },
  billing: {
    pastDue: async (ctx, policyId) =>
      (
        await uow.run(ctx, async (tx) => pastDueOf(await invoices.listByPolicy(tx, ctx, policyId)))
      )?.toJSON() ?? null,
  },
  getProfile,
  sendEmail: async (ctx, message) => {
    await (await mailers.for(ctx)).send(message);
  },
  sendLetter: integrations.sendLetter,
});

const compliance = composeCompliance({
  uow,
  outbox,
  clocks,
  storage: createStorageFromEnv(),
  policies: {
    transaction: makeGetTransactionFacts({ uow, policies }),
    release: async (ctx, id) => {
      const r = await policyServices.catalog.getRelease(ctx, id);

      return { id: r.id, market: r.market, rules: r.rules };
    },
  },
  timeline: {
    record: (tx, ctx, input) =>
      recordPolicyEvent(tx, ctx, { ...input, actor: { type: "system", name: "Compliance" } }),
  },
  channels: filingChannelsFrom(integrations),
  tenantName: async (ctx) => (await getProfile(ctx)).displayName,
});

const events = composeWorkerEvents({
  prisma,
  uow,
  outbox,
  clocks,
  queues,
  integrations,
  mailers,
  policies,
  invoices,
  compliance,
  catalog: policyServices.catalog,
  storage: createStorageFromEnv(),
});

const startNonpayment = makeStartNonpayment(policyServices.changes);
const cureNonpayment = makeCureNonpayment(policyServices.changes);

const installmentTimers = makeInstallmentTimers({
  ...billingEvents,
  uow,
  schedules,
  gateway: integrations.resolver.port("payments"),
  applyEvent: applyBillingEvent,
  notices: {
    remind: async (ctx, input) => {
      const to = await policyServices.emails(ctx, input.policyId);
      const mailer = await mailers.for(ctx);

      for (const address of to) {
        await mailer.send({
          to: address,
          subject: input.subject,
          text: input.text,
          tag: "payment_reminder",
        });
      }

      return to;
    },
  },
  clocks,
});

const billingMethods = composeWorkerBillingMethods({
  uow,
  clocks,
  storage: createStorageFromEnv(),
  logger,
  policies,
  billingEvents,
  applyEvent: applyBillingEvent,
  schedules,
  mortgageeBills,
  installmentTimers,
  branding: async (ctx) => {
    const profile = await getProfile(ctx);

    return {
      name: profile.displayName,
      primaryColor: profile.primaryColor,
      ...(profile.supportEmail && { supportEmail: profile.supportEmail }),
      ...(profile.supportPhone && { supportPhone: profile.supportPhone }),
    };
  },
  mail: {
    sendEmail: async (ctx, message) => {
      await (await mailers.for(ctx)).send(message);
    },
    sendLetter: integrations.sendLetter,
    // Tenant profiles have no postal address yet; real print & mail needs one (TODO.md).
    returnAddress: async (ctx) => ({
      name: (await getProfile(ctx)).displayName,
      line1: "",
      city: "",
      region: "",
      postalCode: "",
      country: "US",
    }),
    insuredEmails: policyServices.emails,
    appUrl: async (ctx) => (await getProfile(ctx)).appUrls[0]!,
  },
  workflows: () => workflows,
});

const systemContext = (tenantId: string) => ({
  tenantId: asId<"Tenant">(tenantId),
  actor: { type: "system" as const, process: "worker" },
});

const underwriting = composeWorkerUnderwriting({
  prisma,
  uow,
  outbox,
  clocks,
  storage: createStorageFromEnv(),
  catalog: policyServices.catalog,
  recordPolicyEvent,
  inspectors: integrations.resolver.port("inspections"),
  logger,
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
    makeInstallmentWorkflow({ timers: installmentTimers }),
    makeObligationWorkflow({ timers: compliance.timers }),
    makeFilingWorkflow({ timers: compliance.timers }),
    ...underwriting.workflows,
    ...billingMethods.workflows,
  ],
});

const workerContext = (tenantId: string) => ({
  tenantId: asId<"Tenant">(tenantId),
  actor: { type: "system" as const, process: "worker" },
});

const dispatch = createDomainEventDispatcher(
  withHandlers(
    {
      ...underwriting.handlers(workflows),
      "*": [
        async (event) => {
          const result = await events.publish(event);

          if (result.published > 0)
            logger.info({ type: event.type, ...result }, "events published");
        },
      ],
      "events.subscription_disabled": [
        async (event) => {
          const { subscriptionId, name, kind } = event.payload as {
            subscriptionId: string;
            name: string;
            kind: string;
          };

          const to = await events.notifyDisabled({
            tenantId: event.tenantId,
            subscriptionId,
            name,
            kind,
          });

          logger.warn(
            { subscriptionId, to },
            "event subscription disabled after sustained failure",
          );
        },
      ],
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
          const { policyId, transactionId } = event.payload as {
            policyId: string;
            transactionId: string;
          };

          const result = await recordCommissions(workerContext(event.tenantId), {
            policyId,
            transactionId,
          });

          logger.info({ transactionId, ...result }, "commissions recorded");
        },
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
        async (event) => {
          const { policyId, transactionId } = event.payload as {
            policyId: string;
            transactionId: string;
          };

          const result = await compliance.createForTransaction(workerContext(event.tenantId), {
            policyId,
            transactionId,
          });

          if (result.created > 0)
            logger.info({ policyId, transactionId, ...result }, "compliance obligations created");
        },
      ],
      "compliance.obligation_created": [
        async (event) => {
          const { obligationId } = event.payload as { obligationId: string };

          await workflows.start(
            workerContext(event.tenantId),
            obligationWorkflow,
            { obligationId },
            { idempotencyKey: `compliance.obligation:${obligationId}` },
          );
        },
      ],
      "compliance.filing_submitted": [
        async (event) => {
          const { obligationId, filingId, manual } = event.payload as {
            obligationId: string;
            filingId: string;
            manual?: boolean;
          };

          if (manual) return;

          await workflows.start(
            workerContext(event.tenantId),
            filingWorkflow,
            { obligationId, filingId },
            { idempotencyKey: `compliance.filing:${filingId}` },
          );
        },
      ],
      "compliance.obligation_escalated": [
        async (event) => logger.warn({ event }, "compliance obligation escalated to the manager"),
      ],
      "billing.installment_scheduled": [
        async (event) => {
          const { invoiceId } = event.payload as { invoiceId: string };

          await workflows.start(
            workerContext(event.tenantId),
            installmentWorkflow,
            { invoiceId },
            { idempotencyKey: `billing.installment:${invoiceId}` },
          );
        },
      ],
      "billing.account_delinquent": [
        async (event) => {
          const { policyId } = event.payload as { policyId: string };
          const result = await startNonpayment(workerContext(event.tenantId), { policyId });

          logger.info({ policyId, result }, "nonpayment");
        },
      ],
      "billing.balance_changed": [
        async (event) => {
          const { policyId } = event.payload as { policyId: string };

          await cureNonpayment(workerContext(event.tenantId), { policyId });
        },
      ],
      "billing.account_current": [
        async (event) => {
          const { policyId } = event.payload as { policyId: string };

          await cureNonpayment(workerContext(event.tenantId), { policyId });
        },
      ],
      "policy.cancellation_held": [
        async (event) =>
          logger.warn(
            { event },
            "cancellation held without proof of mailing; compliance follow-up needed",
          ),
      ],
      "integrations.billing_event_received": [
        async (event) => {
          const { installId, event: inbound } = event.payload as {
            installId: string;
            event: InboundBillingEvent;
          };

          await applyBillingEvent(
            workerContext(event.tenantId),
            billingEventFrom(installId, inbound),
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
    billingMethods.handlers,
  ),
  logger,
);

await queues.work(domainEventsQueue, dispatch);

await queues.work(eventDeliveriesQueue, async (job) => {
  const result = await events.deliver(job);

  logger.info({ deliveryId: job.deliveryId, trigger: job.trigger, ...result }, "event delivery");
});

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
