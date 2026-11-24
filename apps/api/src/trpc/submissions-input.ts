import { z } from "zod";
import { jurisdictionInput } from "./catalog-input";

const id = z.uuid();
const riskData = z.record(z.string(), z.unknown());

export const availableProductsInput = z
  .object({ jurisdiction: jurisdictionInput, effectiveDate: z.iso.date() })
  .partial()
  .refine((input) => !input.jurisdiction === !input.effectiveDate, {
    message: "Give both a jurisdiction and an effective date, or neither",
  });

export const startSubmissionInput = z.object({
  offeringId: id,
  jurisdiction: jurisdictionInput,
  effectiveDate: z.iso.date(),
});

export const chooseOptionInput = z.object({ submissionId: id, productReleaseId: id });

export const submissionById = z.object({ id });
export const submissionData = z.object({ id, riskData });
export const listSubmissionsInput = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .optional();
