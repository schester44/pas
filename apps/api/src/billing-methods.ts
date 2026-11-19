import type {
  AgencyStatementRepository,
  ApplyBillingEvent,
  BillingEventDeps,
  BillingScheduleRepository,
  MortgageeBillRepository,
} from "@pas/billing";
import { composeBillingMethods, portBillingMail } from "@pas/billing/infrastructure";
import type {
  AgencyBilling as DistributionAgencyBilling,
  ProducerOfRecordLookup,
} from "@pas/distribution";
import type { ClockProvider, UnitOfWork } from "@pas/kernel";
import {
  makeGetEvidenceOfInsurance,
  makeGetTransactionFacts,
  type PolicyRepository,
} from "@pas/policy";
import type { ObjectStorage } from "@pas/storage";
import type { AgencyBilling } from "@pas/submissions";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";

/** Agency bill and mortgagee bill in the API (PLAN §13), plus the bind-time agency-bill check. */
export function composeApiBillingMethods(deps: {
  uow: UnitOfWork;
  clocks: ClockProvider;
  storage: ObjectStorage;
  policies: PolicyRepository;
  billingEvents: BillingEventDeps & { statements: AgencyStatementRepository };
  applyEvent: ApplyBillingEvent;
  schedules: BillingScheduleRepository;
  mortgageeBills: MortgageeBillRepository;
  agencyBilling: DistributionAgencyBilling;
  producerOfRecord: ProducerOfRecordLookup;
  branding: Parameters<typeof composeBillingMethods>[0]["branding"];
  mail: Parameters<typeof portBillingMail>[0];
}) {
  const facts = makeGetTransactionFacts({ uow: deps.uow, policies: deps.policies });
  const evidence = makeGetEvidenceOfInsurance({ uow: deps.uow, policies: deps.policies });

  const billing = composeBillingMethods({
    uow: deps.uow,
    clocks: deps.clocks,
    storage: deps.storage,
    billingEvents: deps.billingEvents,
    applyEvent: deps.applyEvent,
    schedules: deps.schedules,
    mortgageeBills: deps.mortgageeBills,
    agencies: deps.agencyBilling,
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
    mail: portBillingMail(deps.mail),
    branding: deps.branding,
    packetPolicy: (ctx, policyId) => evidence(ctx, { policyId }),
    jurisdictionName,
  });

  const agencyBillCheck: AgencyBilling = {
    async check(ctx, input) {
      const record = await deps.producerOfRecord(ctx, {
        userId: input.producerId,
        agencyId: input.agencyId,
      });

      if (!record.agencyId) {
        return {
          agencyId: null,
          agencyName: null,
          available: false,
          reason: "The producer has no agency of record",
        };
      }

      const result = await billing.statements.checkAgencyBill(ctx, {
        agencyId: record.agencyId,
        amount: input.amount,
      });

      return { ...result, agencyId: record.agencyId };
    },
  };

  return { ...billing, agencyBillCheck };
}
