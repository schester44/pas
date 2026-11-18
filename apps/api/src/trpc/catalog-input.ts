import { FORM_CHANNELS, FORM_STAGES } from "@pas/catalog";
import { documentSetSchema } from "@pas/documents";
import { formDefinitionSchema, riskSchemaSchema } from "@pas/forms-core";
import { z } from "zod";

const id = z.uuid();
const plainDate = z.iso.date();
const decimal = z.string().max(32);

export const jurisdictionInput = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  subdivision: z
    .string()
    .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)
    .optional(),
});

const dateWindow = z.object({ from: plainDate, to: plainDate.optional() });

const coverageAmount = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), amount: decimal, currency: z.string().max(3) }),
  z.object({ kind: z.literal("percent"), value: decimal }),
]);

const optionSet = z.object({
  options: z.array(coverageAmount).max(50),
  defaultIndex: z.number().int().min(0),
});

const coverage = z.object({
  code: z.string().max(64),
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
  attachesTo: z.discriminatedUnion("level", [
    z.object({ level: z.literal("policy") }),
    z.object({ level: z.literal("exposure"), path: z.string().min(1).max(500) }),
  ]),
  required: z.boolean(),
  limitOptions: optionSet.optional(),
  deductibleOptions: optionSet.optional(),
  dependsOn: z.array(z.string().max(64)).max(100),
});

export const versionContentsInput = z.object({
  riskSchema: riskSchemaSchema,
  forms: z
    .array(
      z.object({
        channel: z.enum(FORM_CHANNELS),
        stage: z.enum(FORM_STAGES),
        form: formDefinitionSchema,
      }),
    )
    .max(FORM_CHANNELS.length * FORM_STAGES.length),
  coverages: z.array(coverage).max(500),
  availability: z
    .array(
      z.object({ jurisdiction: jurisdictionInput, newBusiness: dateWindow, renewal: dateWindow }),
    )
    .max(300),
  lifecycle: z.record(z.string(), z.unknown()),
  documents: documentSetSchema,
});

export const byId = z.object({ id });
export const byProduct = z.object({ productId: id });
export const versionLabel = z.string().min(1).max(32);
export const updateVersionInput = versionContentsInput.partial().extend({ id });
export const resolveReleaseInput = z.object({
  productKey: z.string().min(1).max(63),
  jurisdiction: jurisdictionInput,
  effectiveDate: plainDate,
  kind: z.enum(["new_business", "renewal"]),
});
