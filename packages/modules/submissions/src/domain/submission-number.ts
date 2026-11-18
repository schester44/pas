export interface SubmissionNumberFormat {
  prefix: string;
  minDigits: number;
}

export const DEFAULT_SUBMISSION_NUMBER_FORMAT: SubmissionNumberFormat = {
  prefix: "SUB-",
  minDigits: 6,
};

export function formatSubmissionNumber(
  sequence: number,
  format: SubmissionNumberFormat = DEFAULT_SUBMISSION_NUMBER_FORMAT,
): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Submission sequence must be a positive integer, got ${sequence}`);
  }

  return `${format.prefix}${String(sequence).padStart(format.minDigits, "0")}`;
}
