import { eventAudience } from "@pas/auth";
import type { InvoiceRepository } from "@pas/billing";
import { makeListInvoices } from "@pas/billing";
import type { Compliance } from "@pas/compliance/infrastructure";
import type { PrismaClient } from "@pas/db";
import { composeEvents } from "@pas/events/infrastructure";
import type { EmailSender } from "@pas/integrations";
import { AesSecretBox, type Integrations } from "@pas/integrations/infrastructure";
import type { Outbox, ProviderFor, UnitOfWork } from "@pas/kernel";
import { makeGetPolicy, type PolicyRepository } from "@pas/policy";
import type { QueueClient } from "@pas/queues";
import type { ObjectStorage } from "@pas/storage";
import { makeGetQuote, makeGetSubmission, type ProductCatalog } from "@pas/submissions";
import { PrismaQuoteRepository, PrismaSubmissionRepository } from "@pas/submissions/infrastructure";
import type { TenantClocks } from "@pas/tenants/infrastructure";
import { makeEventSubjects } from "./event-subjects";

/** Public events for the worker: publishing from domain events, deliveries and admin emails. */
export function composeWorkerEvents(deps: {
  prisma: PrismaClient;
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: TenantClocks;
  queues: QueueClient;
  integrations: Integrations;
  mailers: ProviderFor<EmailSender>;
  policies: PolicyRepository;
  invoices: InvoiceRepository;
  compliance: Compliance;
  catalog: ProductCatalog;
  storage: ObjectStorage;
}) {
  const { uow } = deps;
  const submissions = new PrismaSubmissionRepository();
  const quotes = new PrismaQuoteRepository();

  return composeEvents({
    prisma: deps.prisma,
    uow,
    outbox: deps.outbox,
    clocks: deps.clocks,
    queues: deps.queues,
    secretBox: new AesSecretBox(process.env.INTEGRATIONS_SECRET_KEY),
    isSandbox: async (tenantId) => {
      await deps.clocks.refresh(tenantId);

      return deps.clocks.isSandbox(tenantId);
    },
    allowPrivateUrls: process.env.NODE_ENV === "development",
    chat: async (ctx) => {
      const chosen = await deps.integrations.resolver.primary(ctx, "chat");

      return {
        provider:
          deps.integrations.catalog.get(chosen.providerId)?.manifest.name ?? chosen.providerId,
        post: (message) => chosen.adapter.post(message),
      };
    },
    classify: eventAudience,
    adminOrigin: process.env.ADMIN_ORIGIN ?? "http://localhost:5173",
    subjects: makeEventSubjects({
      uow,
      submissions: makeGetSubmission({ uow, submissions, quotes, catalog: deps.catalog }),
      quotes: makeGetQuote({ uow, submissions, quotes }),
      policies: makeGetPolicy({ uow, policies: deps.policies, storage: deps.storage }),
      invoices: makeListInvoices({ uow, invoices: deps.invoices }),
      compliance: deps.compliance,
    }),
    mailer: {
      send: async (ctx, message) => {
        await (await deps.mailers.for(ctx)).send(message);
      },
    },
  });
}
