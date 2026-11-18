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

const open = (quote: Quote, ignore: readonly Requirement["kind"][]) =>
  quote.requirements.filter((r) => r.blocking && !r.satisfied && !ignore.includes(r.kind));

export const readyToSign = (quote: Quote) => open(quote, ["signature", "payment"]).length === 0;
export const readyToPay = (quote: Quote) => open(quote, ["payment"]).length === 0;

/** The furthest step the quote's state allows; earlier steps stay reachable. */
export function furthestStep(quote: Quote): number {
  if (readyToPay(quote)) return 4;

  if (quote.detailsSaved && readyToSign(quote)) return 3;

  return 2;
}

/** Where a returning agent lands: approval resumes at Details, then wherever they left off. */
export function resumeStep(quote: Quote): StepId {
  const furthest = furthestStep(quote);

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
