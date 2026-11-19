import type { TenantContext } from "@pas/kernel";
import type { CanonicalInput, FlowSubject } from "../domain/canonical";
import type { Capability } from "../domain/connector";
import { mergePdfs } from "./adapters";
import type { Carriers } from "./compose";

interface StartInput {
  carrier: string;
  capability: Capability;
  subject: FlowSubject;
  input: CanonicalInput;
  idempotencyKey: string;
}

/**
 * The `CarrierGateway` port as submissions (quote, bind, issue) and policy (changes) see it:
 * one start for every connection kind, plus links, documents and packet merging.
 */
export function carrierGateways(carriers: Carriers) {
  const { services } = carriers;

  const start = (ctx: TenantContext, input: StartInput) =>
    carriers.startFlow(ctx, {
      carrier: { key: input.carrier },
      capability: input.capability,
      subject: input.subject,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
    });

  return {
    gateway: {
      start,
      carrierName: services.name,
      documents: services.fetchDocuments,
      linkPolicy: (
        ctx: TenantContext,
        input: {
          carrier: string;
          policyId: string;
          quoteId: string;
          carrierPolicyNumber: string | null;
          carrierReference: string | null;
        },
      ) =>
        services.linkPolicy(ctx, {
          carrierKey: input.carrier,
          policyId: input.policyId,
          quoteId: input.quoteId,
          carrierPolicyNumber: input.carrierPolicyNumber,
          carrierReference: input.carrierReference,
          status: "issued",
        }),
      mergePdfs,
    },
    transactions: {
      start,
      carrierName: services.name,
      link: (ctx: TenantContext, policyId: string) => services.policyLink(ctx, { policyId }),
    },
  };
}
