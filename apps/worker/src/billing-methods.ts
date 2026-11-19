import {
  agencyAccountWorkflow,
  type AgencyStatementRepository,
  type ApplyBillingEvent,
  type BillingEventDeps,
  type BillingScheduleRepository,
  type InstallmentTimers,
  type MortgageeBillRepository,
  mortgageeBillWorkflow,
} from "@pas/billing";
import { composeBillingMethods, portBillingMail } from "@pas/billing/infrastructure";
import { makeAgencyBilling } from "@pas/distribution";
import {
  PrismaAgencyRepository,
  PrismaCommissionRepository,
  PrismaProducerRepository,
} from "@pas/distribution/infrastructure";
import {
  asId,
  type ClockProvider,
  type TenantContext,
  type UnitOfWork,
  type Workflows,
} from "@pas/kernel";
import type { Logger } from "@pas/observability";
import {
  makeChangeBillingMethod,
  makeGetEvidenceOfInsurance,
  makeGetTransactionFacts,
  type PolicyRepository,
} from "@pas/policy";
import type { ObjectStorage } from "@pas/storage";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import type { DomainEventHandler } from "./handlers/domain-events";
import { makeAgencyAccountWorkflow, makeMortgageeBillWorkflow } from "./workflows/billing-methods";

type Mail = Parameters<typeof portBillingMail>[0];

const contextOf = (tenantId: string): TenantContext => ({
  tenantId: asId<"Tenant">(tenantId),
  actor: { type: "system", process: "worker" },
});

/** Agency bill and mortgagee bill in the worker: services, workflows and event handlers (PLAN §13). */
export function composeWorkerBillingMethods(deps: {
  uow: UnitOfWork;
  clocks: ClockProvider;
  storage: ObjectStorage;
  logger: Logger;
  policies: PolicyRepository;
  billingEvents: BillingEventDeps & { statements: AgencyStatementRepository };
  applyEvent: ApplyBillingEvent;
  schedules: BillingScheduleRepository;
  mortgageeBills: MortgageeBillRepository;
  installmentTimers: InstallmentTimers;
  branding: Parameters<typeof composeBillingMethods>[0]["branding"];
  mail: Mail;
  workflows: () => Pick<Workflows, "start">;
}) {
  const { uow, clocks } = deps;

  const agencyBilling = makeAgencyBilling({
    uow,
    clocks,
    agencies: new PrismaAgencyRepository(),
    producers: new PrismaProducerRepository(),
    commissions: new PrismaCommissionRepository(),
  });

  const facts = makeGetTransactionFacts({ uow, policies: deps.policies });
  const evidence = makeGetEvidenceOfInsurance({ uow, policies: deps.policies });
  const changeBillingMethod = makeChangeBillingMethod({ uow, policies: deps.policies, clocks });
  const mail = portBillingMail(deps.mail);

  const billing = composeBillingMethods({
    uow,
    clocks,
    storage: deps.storage,
    billingEvents: deps.billingEvents,
    applyEvent: deps.applyEvent,
    schedules: deps.schedules,
    mortgageeBills: deps.mortgageeBills,
    agencies: agencyBilling,
    transactions: {
      describe: async (ctx, input) => {
        const f = await facts(ctx, input);

        return {
          type: f.transaction.type,
          effectiveDate: f.transaction.effectiveDate,
          insuredName: f.insuredName,
        };
      },
    },
    mail,
    branding: deps.branding,
    packetPolicy: (ctx, policyId) => evidence(ctx, { policyId }),
    jurisdictionName,
  });

  const notifyAgency = async (
    ctx: TenantContext,
    agencyId: string,
    subject: string,
    text: string,
  ) => {
    const terms = await agencyBilling.terms(ctx, { agencyId });

    for (const to of terms.contacts)
      await mail.email(ctx, { to, subject, text, tag: "agency_bill" });
  };

  const handlers: Record<string, DomainEventHandler[]> = {
    "billing.agency_invoice_issued": [
      async (event) => {
        const { agencyId } = event.payload as { agencyId: string };
        const ctx = contextOf(event.tenantId);
        const cutoff = await billing.statements.cutoffFor(ctx, { agencyId });

        await deps
          .workflows()
          .start(
            ctx,
            agencyAccountWorkflow,
            { agencyId, cutoff },
            { idempotencyKey: `billing.agency_account:${agencyId}:${cutoff}` },
          );
      },
    ],
    "billing.agency_bill_delinquent": [
      async (event) => {
        const { agencyId, reason } = event.payload as { agencyId: string; reason: string };
        const ctx = contextOf(event.tenantId);

        if (!(await agencyBilling.suspend(ctx, { agencyId, reason }))) return;

        const terms = await agencyBilling.terms(ctx, { agencyId });

        await notifyAgency(
          ctx,
          agencyId,
          `Agency bill suspended for ${terms.name}`,
          `${reason}. New policies bound by ${terms.name} are billed directly to the insured until the account is brought current. Existing policies stay in force.`,
        );

        deps.logger.warn({ agencyId, reason }, "agency bill suspended");
      },
    ],
    "billing.agency_statement_changed": [
      async (event) => {
        const { agencyId, status } = event.payload as { agencyId: string; status: string };
        const ctx = contextOf(event.tenantId);

        if (status !== "paid" || (await billing.statements.hasPastDue(ctx, { agencyId }))) return;

        if (!(await agencyBilling.restore(ctx, { agencyId }))) return;

        const terms = await agencyBilling.terms(ctx, { agencyId });

        await notifyAgency(
          ctx,
          agencyId,
          `Agency bill restored for ${terms.name}`,
          `Thanks: the account is current again, and ${terms.name} can bind on agency bill.`,
        );
      },
    ],
    "billing.mortgagee_bill_started": [
      async (event) => {
        const { mortgageeBillId } = event.payload as { mortgageeBillId: string };

        await deps
          .workflows()
          .start(
            contextOf(event.tenantId),
            mortgageeBillWorkflow,
            { mortgageeBillId, attempt: 1 },
            { idempotencyKey: `billing.mortgagee_bill:${mortgageeBillId}:${event.id}` },
          );
      },
    ],
    "billing.billing_method_changed": [
      async (event) => {
        const input = event.payload as {
          policyId: string;
          termId: string;
          billingMethod: "direct" | "agency" | "mortgagee";
        };

        await changeBillingMethod(contextOf(event.tenantId), input);
      },
    ],
    "policy.transaction_issued": [
      async (event) => {
        const { policyId, type } = event.payload as { policyId: string; type: string };

        if (type !== "ENDORSEMENT") return;

        const ctx = contextOf(event.tenantId);
        const [lender] = (await evidence(ctx, { policyId })).mortgagees;

        if (!lender) return;

        const changed = await billing.mortgagee.changeLender(ctx, {
          policyId,
          lender: {
            name: lender.name,
            loanNumber: lender.reference,
            address: lender.address as never,
            email: lender.email,
          },
        });

        if (changed)
          deps.logger.info(
            { policyId, lender: lender.name },
            "mortgagee bill moved to the new lender",
          );
      },
    ],
  };

  return {
    ...billing,
    agencyBilling,
    handlers,
    workflows: [
      makeAgencyAccountWorkflow({ statements: billing.statements, timers: deps.installmentTimers }),
      makeMortgageeBillWorkflow({ mortgagee: billing.mortgagee, timers: deps.installmentTimers }),
    ],
  };
}

/** Adds handlers to a dispatch table, after the ones already there. */
export function withHandlers(
  base: Record<string, DomainEventHandler[]>,
  extra: Record<string, DomainEventHandler[]>,
): Record<string, DomainEventHandler[]> {
  const merged = { ...base };

  for (const [type, handlers] of Object.entries(extra)) {
    merged[type] = [...(merged[type] ?? []), ...handlers];
  }

  return merged;
}
