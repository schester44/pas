export const DOWNLOAD_FORMATS = ["acord_xml", "al3"] as const;

export type DownloadFormatId = (typeof DOWNLOAD_FORMATS)[number];

export const TRANSACTION_KINDS = [
  "new_business",
  "endorsement",
  "cancellation",
  "reinstatement",
  "renewal",
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

const KIND_OF: Record<string, TransactionKind> = {
  NEW_BUSINESS: "new_business",
  ENDORSEMENT: "endorsement",
  CANCELLATION: "cancellation",
  CANCELLATION_RESCISSION: "reinstatement",
  REINSTATEMENT: "reinstatement",
  RENEWAL: "renewal",
};

export const transactionKindOf = (type: string): TransactionKind | null => KIND_OF[type] ?? null;

/** What the tenant chose on its agency downloads install. */
export interface DownloadSettings {
  participantCode: string;
  format: DownloadFormatId;
  /** "HH:MM" in `timeZone`. */
  batchTime: string;
  timeZone: string;
  transactionKinds: readonly TransactionKind[];
  documents: boolean;
  commissionStatements: boolean;
  /** The tenant's line of business and coverage codes mapped to ACORD codes. */
  lobCodes: Readonly<Record<string, string>>;
  coverageCodes: Readonly<Record<string, string>>;
}

/** "homeowners=HOME, dwelling_fire=DFIRE" as a lookup; blank pairs are ignored. */
export function parseCodeMap(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/[,\n]/)
      .map((pair) => pair.split("=").map((part) => part.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && !!pair[0] && !!pair[1]),
  );
}

const asCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 10);

export const acordCode = (map: Readonly<Record<string, string>>, code: string) =>
  map[code] ?? asCode(code);
