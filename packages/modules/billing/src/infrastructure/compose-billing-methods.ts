import { type ClockProvider, newId, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { type BilledTransactions, makeAgencyStatements } from "../application/agency-statements";
import type { ApplyBillingEvent, BillingEventDeps } from "../application/apply-billing-event";
import { makeMortgageeBilling } from "../application/mortgagee-billing";
import type { PayerAddress } from "../domain/invoice";
import type { AgencyDirectory } from "../ports/agency-directory";
import type { BillingMail } from "../ports/billing-mail";
import type { BillingScheduleRepository } from "../ports/billing-schedule-repository";
import type { MortgageeBillRepository } from "../ports/mortgagee-bill-repository";
import type { AgencyStatementRepository } from "../ports/agency-statement-repository";
import { type PacketPolicy, ReactPdfBillingDocuments } from "./react-pdf-billing-documents";

interface PostalAddress extends PayerAddress {
  name: string;
  country: string;
}

/** Billing's mail through the tenant's email and print & mail integrations. */
export function portBillingMail(deps: {
  sendEmail(
    ctx: TenantContext,
    message: { to: string; subject: string; text: string; tag: string },
  ): Promise<void>;
  sendLetter(
    ctx: TenantContext,
    input: {
      reference: { kind: "policy_notice"; policyId: string; transactionId: string; title: string };
      letter: {
        reference: string;
        description: string;
        to: PostalAddress;
        from: PostalAddress;
        mailType: "first_class";
        document: Uint8Array;
      };
    },
  ): Promise<{ proof: { trackingNumber: string | null } | null }>;
  returnAddress(ctx: TenantContext): Promise<PostalAddress>;
  insuredEmails(ctx: TenantContext, policyId: string): Promise<string[]>;
  appUrl(ctx: TenantContext): Promise<string>;
}): BillingMail {
  return {
    email: deps.sendEmail,
    insuredEmails: deps.insuredEmails,
    async letter(ctx, input) {
      const sent = await deps.sendLetter(ctx, {
        reference: {
          kind: "policy_notice",
          policyId: input.policyId,
          transactionId: input.transactionId,
          title: input.title,
        },
        letter: {
          reference: `${input.transactionId}:${newId()}`,
          description: input.title,
          to: {
            ...input.to.address,
            name: input.to.name,
            country: input.to.address.country ?? "US",
          },
          from: await deps.returnAddress(ctx),
          mailType: "first_class",
          document: input.pdf,
        },
      });

      return { mailed: sent.proof !== null, trackingNumber: sent.proof?.trackingNumber ?? null };
    },
    links: {
      agencyStatements: async (ctx) => new URL("/agency", await deps.appUrl(ctx)).toString(),
      policyBilling: async (ctx, policyId) =>
        new URL(`/portal/policies/${policyId}`, await deps.appUrl(ctx)).toString(),
    },
  };
}

/** Agency bill and mortgagee bill services, shared by the API and the worker. */
export function composeBillingMethods(deps: {
  uow: UnitOfWork;
  clocks: ClockProvider;
  storage: ObjectStorage;
  billingEvents: BillingEventDeps & { statements: AgencyStatementRepository };
  applyEvent: ApplyBillingEvent;
  schedules: BillingScheduleRepository;
  mortgageeBills: MortgageeBillRepository;
  agencies: AgencyDirectory;
  transactions: BilledTransactions;
  mail: BillingMail;
  branding: ConstructorParameters<typeof ReactPdfBillingDocuments>[0]["branding"];
  packetPolicy: (ctx: TenantContext, policyId: string) => Promise<PacketPolicy>;
  jurisdictionName: (jurisdiction: { country: string; subdivision?: string }) => string;
}) {
  const documents = new ReactPdfBillingDocuments({
    branding: deps.branding,
    policy: deps.packetPolicy,
    jurisdictionName: deps.jurisdictionName,
  });

  const shared = {
    ...deps.billingEvents,
    uow: deps.uow,
    clocks: deps.clocks,
    storage: deps.storage,
    documents,
    mail: deps.mail,
    applyEvent: deps.applyEvent,
  };

  return {
    statements: makeAgencyStatements({
      ...shared,
      statements: deps.billingEvents.statements,
      agencies: deps.agencies,
      transactions: deps.transactions,
    }),
    mortgagee: makeMortgageeBilling({
      ...shared,
      schedules: deps.schedules,
      mortgageeBills: deps.mortgageeBills,
    }),
  };
}
