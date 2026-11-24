import type { AppOutputs } from "@pas/api-client";
import type { StatusTone } from "@pas/ui/components/status-chip";
import { formatMoney } from "./format";

export type Quote = NonNullable<AppOutputs["quotes"]["get"]>;
export type QuoteCoverage = Quote["coverages"][number];
export type CoverageAmount = QuoteCoverage["limits"][number];
export type Requirement = Quote["requirements"][number];

export const STEPS = [
  { id: "quote", title: "Quote" },
  { id: "customize", title: "Customize" },
  { id: "details", title: "Details" },
  { id: "review", title: "Review and sign" },
  { id: "pay", title: "Pay" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export const isStep = (value: unknown): value is StepId => STEPS.some((step) => step.id === value);

/** Steps the insured completes from their link; the producer moves past them while they wait. */
export interface InsuredSteps {
  disclosures: boolean;
  signature: boolean;
}

const NONE: InsuredSteps = { disclosures: false, signature: false };

const open = (quote: Quote, ignore: readonly Requirement["kind"][]) =>
  quote.requirements.filter((r) => r.blocking && !r.satisfied && !ignore.includes(r.kind));

const owned = (insured: InsuredSteps): Requirement["kind"][] => [
  ...(insured.disclosures ? (["attestation"] as const) : []),
  ...(insured.signature ? (["signature"] as const) : []),
];

export const readyToSign = (quote: Quote, insured = NONE) =>
  open(quote, ["signature", "payment", ...owned(insured)]).length === 0;

export const readyToPay = (quote: Quote, insured = NONE) =>
  open(quote, ["payment", ...owned(insured)]).length === 0;

/** The furthest step the quote's state allows; earlier steps stay reachable. */
export function furthestStep(quote: Quote, insured = NONE): number {
  if (quote.detailsSaved && readyToPay(quote, insured)) return 4;

  if (quote.detailsSaved && readyToSign(quote, insured)) return 3;

  return 2;
}

/** Where a returning agent lands: approval resumes at Details, then wherever they left off. */
export function resumeStep(quote: Quote, insured = NONE): StepId {
  const furthest = furthestStep(quote, insured);

  if (furthest >= 3) return STEPS[furthest]!.id;

  if (quote.detailsSaved || quote.approved) return "details";

  return "quote";
}

export function amountLabel(amount: CoverageAmount): string {
  return amount.kind === "money"
    ? formatMoney({ amount: amount.amount, currency: amount.currency })
    : `${amount.value}%`;
}

export const sameAmount = (a: CoverageAmount | null, b: CoverageAmount | null) =>
  !!a && !!b && amountLabel(a) === amountLabel(b);

export const QUOTE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  quoted: { label: "Quoted", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
  referred: { label: "Referred", tone: "warning" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  bound: { label: "Bound", tone: "success" },
};
