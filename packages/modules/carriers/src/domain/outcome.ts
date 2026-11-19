import { isRecord } from "@pas/kernel";

export const OUTCOME_STATUSES = [
  "quoted",
  "referred",
  "declined",
  "bound",
  "issued",
  "confirmed",
  "failed",
] as const;

export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export interface CarrierPremiumLine {
  coverage: string;
  exposure?: string;
  amount: string;
}

export interface CarrierChargeLine {
  code: string;
  label: string;
  amount: string;
}

export interface CarrierDocumentRef {
  title: string;
  url: string;
  kind?: string;
}

export interface CarrierMessage {
  code?: string;
  text: string;
}

/** The canonical result every carrier gateway returns, however it is connected. */
export interface CarrierOutcome {
  status: OutcomeStatus;
  reference?: string;
  policyNumber?: string;
  premium?: {
    currency?: string;
    lines: CarrierPremiumLine[];
    taxesFees: CarrierChargeLine[];
  };
  documents: CarrierDocumentRef[];
  messages: CarrierMessage[];
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;

const amount = (value: unknown): string | undefined =>
  typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))
    ? String(value)
    : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Reads a flow's mapped output into the canonical outcome, reporting what doesn't fit. */
export function outcomeFrom(value: unknown): { outcome: CarrierOutcome; issues: string[] } {
  const issues: string[] = [];
  const source = isRecord(value) ? value : {};

  if (!isRecord(value)) issues.push("The output mapping must produce an object");

  const status = OUTCOME_STATUSES.find((s) => s === source.status);

  if (!status) {
    issues.push(
      `status must be one of ${OUTCOME_STATUSES.join(", ")} (got ${String(source.status)})`,
    );
  }

  const premium = isRecord(source.premium) ? source.premium : null;

  const lines = list(premium?.lines).flatMap((line, i): CarrierPremiumLine[] => {
    const coverage = isRecord(line) ? text(line.coverage) : undefined;
    const lineAmount = isRecord(line) ? amount(line.amount) : undefined;

    if (!coverage || lineAmount === undefined) {
      issues.push(`premium.lines[${i}] needs a coverage and a numeric amount`);

      return [];
    }

    const exposure = isRecord(line) ? text(line.exposure) : undefined;

    return [{ coverage, ...(exposure && { exposure }), amount: lineAmount }];
  });

  const taxesFees = list(premium?.taxesFees).flatMap((line, i): CarrierChargeLine[] => {
    const code = isRecord(line) ? text(line.code) : undefined;
    const feeAmount = isRecord(line) ? amount(line.amount) : undefined;

    if (!code || feeAmount === undefined) {
      issues.push(`premium.taxesFees[${i}] needs a code and a numeric amount`);

      return [];
    }

    return [{ code, label: (isRecord(line) && text(line.label)) || code, amount: feeAmount }];
  });

  const documents = list(source.documents).flatMap((doc, i): CarrierDocumentRef[] => {
    const url = isRecord(doc) ? text(doc.url) : undefined;

    if (!url) {
      issues.push(`documents[${i}] needs a url`);

      return [];
    }

    const kind = isRecord(doc) ? text(doc.kind) : undefined;

    return [
      {
        title: (isRecord(doc) && text(doc.title)) || "Carrier document",
        url,
        ...(kind && { kind }),
      },
    ];
  });

  const messages = list(source.messages).flatMap((message): CarrierMessage[] => {
    if (typeof message === "string") return [{ text: message }];

    const body = isRecord(message) ? text(message.text) : undefined;
    const code = isRecord(message) ? text(message.code) : undefined;

    return body ? [{ ...(code && { code }), text: body }] : [];
  });

  const reference = text(source.reference);
  const policyNumber = text(source.policyNumber);
  const currency = premium ? text(premium.currency) : undefined;

  return {
    outcome: {
      status: status ?? "failed",
      ...(reference && { reference }),
      ...(policyNumber && { policyNumber }),
      ...(premium && { premium: { ...(currency && { currency }), lines, taxesFees } }),
      documents,
      messages,
    },
    issues,
  };
}

export const isSuccess = (outcome: CarrierOutcome) =>
  outcome.status !== "failed" && outcome.status !== "declined";
