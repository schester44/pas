import { FORM_CHANNELS, FORM_STAGES, MARKETS } from "@pas/catalog";
import { DECISION_KIND_KEYS, type JdmDecision } from "@pas/decisions-engine";
import { documentSetSchema } from "@pas/documents";
import { formDefinitionSchema, riskSchemaSchema } from "@pas/forms-core";
import { BILLING_METHODS, emptyBillingConfig } from "@pas/pay-plans";
import type { BindingManifest, RatingPlan } from "@pas/rating-engine";
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

const json = z.record(z.string(), z.unknown());

// Drafts may be incomplete: the publish checks validate these artifacts in depth.
const draft = <T>(required: string[]) =>
  z.custom<T>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      required.every((key) => Array.isArray((value as Record<string, unknown>)[key])),
  );

const artifact = draft<JdmDecision>(["nodes", "edges"]);
const plan = draft<RatingPlan>(["tables", "algorithms"]);
const manifest = draft<BindingManifest>(["inputs", "outputs"]);

const decision = z.object({
  kind: z.enum(DECISION_KIND_KEYS),
  key: z.string().max(64),
  name: z.string().max(200),
  decision: artifact,
  tests: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().max(200),
        input: json,
        expected: z.unknown(),
      }),
    )
    .max(200),
});

const coverageSelection = z.object({
  coverage: z.string().min(1).max(64),
  exposure: z.string().max(200).optional(),
  limit: decimal.optional(),
  deductible: decimal.optional(),
  options: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export const ratingInput = z.object({
  risk: json,
  coverages: z.array(coverageSelection).max(500),
  term: z.object({ effective: plainDate, expiration: plainDate }),
  transaction: z.object({
    type: z.enum([
      "NEW_BUSINESS",
      "ENDORSEMENT",
      "CANCELLATION",
      "CANCELLATION_RESCISSION",
      "REINSTATEMENT",
      "RENEWAL",
      "REWRITE",
      "AUDIT",
    ]),
    effective: plainDate,
  }),
  enrichment: json.optional(),
  jurisdiction: jurisdictionInput,
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const goldenCase = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  input: ratingInput,
  expected: z.object({
    coverages: z
      .array(
        z.object({
          coverage: z.string().max(64),
          exposure: z.string().max(200).optional(),
          premium: decimal,
        }),
      )
      .max(500)
      .optional(),
    factors: z
      .array(
        z.object({
          name: z.string().max(64),
          coverage: z.string().max(64).optional(),
          exposure: z.string().max(200).optional(),
          value: decimal,
        }),
      )
      .max(500)
      .optional(),
    total: decimal.optional(),
  }),
  tolerance: z.object({ absolute: decimal.optional(), relative: decimal.optional() }).optional(),
});

export const raterSourceInput = z.discriminatedUnion("engine", [
  z.object({ engine: z.literal("plan"), plan }),
  z.object({ engine: z.literal("spreadsheet"), workbookId: z.uuid().nullable(), manifest }),
]);

export const ratingConfigInput = z.discriminatedUnion("engine", [
  z.object({
    engine: z.literal("plan"),
    plan,
    goldenCases: z.array(goldenCase).max(500),
  }),
  z.object({
    engine: z.literal("spreadsheet"),
    workbookId: z.uuid().nullable(),
    manifest,
    goldenCases: z.array(goldenCase).max(500),
  }),
]);

const decimalText = z.string().regex(/^\d+(\.\d+)?$/);
const days = z.number().int().min(0).max(366);

const payPlan = z.object({
  key: z.string().min(1).max(40),
  label: z.string().max(80),
  installments: z.number().int().min(1).max(24),
  intervalMonths: z.number().int().min(1).max(12),
  downPayment: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("first_installment") }),
    z.object({ kind: z.literal("percent"), percent: decimalText }),
  ]),
  installmentFee: decimalText.nullable(),
  taxesFees: z.enum(["up_front", "spread"]),
  dueDaysBefore: days,
  billDaysBeforeDue: days,
  graceDays: days,
  eligibility: z.object({
    minPremium: decimalText.optional(),
    jurisdictions: z.array(z.string().max(6)).max(100).optional(),
    channels: z.array(z.string().max(20)).max(10).optional(),
    mortgageeBilling: z.boolean().optional(),
    when: z.string().max(2000).optional(),
  }),
});

const billingConfig = z.object({
  payPlans: z.array(payPlan).max(20),
  defaultPlan: z.string().max(40).nullable(),
  dunning: z.object({
    retryAfterDays: days,
    retries: z.number().int().min(0).max(5),
    reminderAfterDays: days,
    delinquencySource: z.enum(["pas", "billing_system"]),
  }),
  methods: z
    .array(z.enum(BILLING_METHODS))
    .max(3)
    .default(() => emptyBillingConfig().methods),
  mortgagee: z
    .object({
      dueDays: days,
      reminderDays: z.array(days).max(6),
      offerDirectAfterDays: days,
      nonpaymentAfterDays: days,
    })
    .default(() => emptyBillingConfig().mortgagee),
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
      z.object({
        jurisdiction: jurisdictionInput,
        newBusiness: dateWindow,
        renewal: dateWindow,
        market: z.enum(MARKETS).optional(),
      }),
    )
    .max(300),
  lifecycle: z.record(z.string(), z.unknown()),
  documents: documentSetSchema,
  rules: z.array(decision).max(100),
  rating: ratingConfigInput.nullable(),
  billing: billingConfig,
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
