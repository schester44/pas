export function formatInvoiceNumber(sequence: number, prefix = "INV-", minDigits = 6): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Invoice sequence must be a positive integer, got ${sequence}`);
  }

  return `${prefix}${String(sequence).padStart(minDigits, "0")}`;
}
