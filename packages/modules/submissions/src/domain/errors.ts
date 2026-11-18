import { DomainError, type Jurisdiction } from "@pas/kernel";
import type { SubmissionStatus } from "./submission";

export class ProductUnavailableError extends DomainError {
  constructor(details: { productName: string; jurisdiction: Jurisdiction; effectiveDate: string }) {
    const where = details.jurisdiction.subdivision ?? details.jurisdiction.country;

    super(
      "precondition_failed",
      `${details.productName} isn't available in ${where} on ${details.effectiveDate}`,
      { reason: "product_unavailable", ...details },
    );
  }
}

export class IntakeFormMissingError extends DomainError {
  constructor(details: { productName: string; channel: string; stage: string }) {
    super(
      "precondition_failed",
      `${details.productName} has no ${details.channel} ${details.stage} form`,
      { reason: "form_missing", ...details },
    );
  }
}

export class SubmissionStatusError extends DomainError {
  constructor(number: string, status: SubmissionStatus, action: string) {
    super("conflict", `${number} is ${status}, so it can't be ${action}`, {
      reason: "invalid_status",
      status,
    });
  }
}
