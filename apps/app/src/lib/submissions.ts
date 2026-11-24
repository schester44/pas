import type { StatusTone } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { formatPlainDate } from "./format";
import { QUOTE_STATUS } from "./quotes";

export const SUBMISSION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "accent" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export function submissionStatus(
  status: string,
  quote?: { status: string; approved: boolean } | null,
  awaitingChoice = false,
) {
  if (awaitingChoice) return { label: "Choose a quote", tone: "accent" as const };

  if (quote)
    return (
      QUOTE_STATUS[quote.approved && quote.status === "quoted" ? "approved" : quote.status] ??
      QUOTE_STATUS.quoted!
    );

  return SUBMISSION_STATUS[status] ?? { label: status, tone: "neutral" as const };
}

interface Unavailable {
  productName: string;
  jurisdiction: { country: string; subdivision?: string };
  effectiveDate: string;
}

export function unavailableMessage({ productName, jurisdiction, effectiveDate }: Unavailable) {
  return `${productName} isn't available in ${jurisdictionName(jurisdiction)} on ${formatPlainDate(effectiveDate)}.`;
}

export function isUnavailable(details: unknown): details is Unavailable {
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { reason?: unknown }).reason === "product_unavailable"
  );
}

/** The offering's name until a quote option is chosen, then the chosen product's. */
export function submissionTitle(submission: {
  status: string;
  awaitingChoice: boolean;
  offeringName: string | null;
  productName: string;
}) {
  const choosing = submission.status === "draft" || submission.awaitingChoice;

  return (choosing && submission.offeringName) || submission.productName;
}
