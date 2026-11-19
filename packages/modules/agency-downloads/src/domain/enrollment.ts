import { type Instant, invalid, type PlainDate, type TenantId } from "@pas/kernel";

export interface AgencyCode {
  carrier: string;
  code: string;
}

/** An agency's opt-in to downloads: its IVANS account, mailbox and contract codes (PLAN §17.4). */
export interface Enrollment {
  id: string;
  tenantId: TenantId;
  agencyId: string;
  accountCode: string;
  mailbox: string | null;
  agencyCodes: AgencyCode[];
  enabled: boolean;
  startDate: PlainDate;
  createdAt: Instant;
  updatedAt: Instant;
}

// IVANS account codes are a Y followed by four letters or digits (e.g. YAB1D).
const ACCOUNT_CODE = /^Y[A-Z0-9]{4}$/;
const MAILBOX = /^[A-Z0-9]{1,8}$/;

export function normalizeAccountCode(value: string): string {
  const code = value.trim().toUpperCase();

  if (!ACCOUNT_CODE.test(code)) {
    throw invalid("An IVANS account code is a Y and four letters or digits, like YAB1D", {
      field: "accountCode",
    });
  }

  return code;
}

export function normalizeMailbox(value: string | null): string | null {
  const mailbox = value?.trim().toUpperCase() || null;

  if (mailbox && !MAILBOX.test(mailbox)) {
    throw invalid("A mailbox is up to eight letters or digits", { field: "mailbox" });
  }

  return mailbox;
}

export function normalizeAgencyCodes(codes: readonly AgencyCode[]): AgencyCode[] {
  const cleaned = codes
    .map((c) => ({ carrier: c.carrier.trim(), code: c.code.trim() }))
    .filter((c) => c.code);

  if (cleaned.length === 0) {
    throw invalid("Add the agency's code with at least one carrier", { field: "agencyCodes" });
  }

  return cleaned;
}

/** The contract code an AMS matches on: the one for the policy's carrier, else the first. */
export const agencyCodeFor = (enrollment: Pick<Enrollment, "agencyCodes">, carrier?: string) =>
  enrollment.agencyCodes.find((c) => carrier && c.carrier === carrier)?.code ??
  enrollment.agencyCodes[0]?.code ??
  null;

export const enrolledOn = (enrollment: Pick<Enrollment, "enabled" | "startDate">, on: PlainDate) =>
  enrollment.enabled && Temporal.PlainDate.compare(on, enrollment.startDate) >= 0;
