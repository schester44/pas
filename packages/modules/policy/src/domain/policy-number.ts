export interface PolicyNumberFormat {
  prefix: string;
  minDigits: number;
}

export const DEFAULT_POLICY_NUMBER_FORMAT: PolicyNumberFormat = { prefix: "POL-", minDigits: 7 };

export function formatPolicyNumber(
  sequence: number,
  format: PolicyNumberFormat = DEFAULT_POLICY_NUMBER_FORMAT,
): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Policy sequence must be a positive integer, got ${sequence}`);
  }

  return `${format.prefix}${String(sequence).padStart(format.minDigits, "0")}`;
}
