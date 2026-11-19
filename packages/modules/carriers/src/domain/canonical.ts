import type { Capability } from "./connector";

type MoneyJson = { amount: string; currency: string };

/**
 * Our side of every carrier conversation. Connector mappings read it as `input`; extensions
 * receive it as is. Built by submissions (quote, bind, issue) and policy (changes).
 */
export interface CanonicalInput {
  capability: Capability;
  product: { id: string; name: string; version: string; releaseId: string };
  jurisdiction: { country: string; subdivision?: string };
  term: { effectiveDate: string; expirationDate: string };
  policy: { id?: string; number?: string; carrierNumber?: string };
  quote?: { id: string; number: string; revision: number };
  transaction?: {
    id: string;
    type: string;
    effectiveDate: string;
    reason?: string;
    premiumChange?: MoneyJson;
  };
  insured: { name: string; mailingAddress?: unknown };
  producer?: { name: string; agency?: string | null };
  risk: Record<string, unknown>;
  coverages: {
    code: string;
    name: string;
    exposure?: string;
    limit?: unknown;
    deductible?: unknown;
    premium?: MoneyJson;
  }[];
  premium: {
    written: MoneyJson;
    taxesFees: { code: string; label: string; amount: MoneyJson }[];
    total: MoneyJson;
  };
  carrier: { reference?: string; policyNumber?: string };
}

export type FlowSubject =
  | { kind: "quote"; quoteId: string; submissionId: string; revision: number }
  | { kind: "new_business"; quoteId: string; submissionId: string; phase: "bind" | "issue" }
  | { kind: "transaction"; policyId: string; transactionId: string; type: string }
  | { kind: "test" };
