import { INTEREST_KINDS } from "@pas/submissions";
import { z } from "zod";

const id = z.uuid();
const text = (max: number) => z.string().trim().max(max);

const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .max(32);

export const amount = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), amount: decimal, currency: z.string().length(3) }),
  z.object({ kind: z.literal("percent"), value: decimal }),
]);

export const address = z.object({
  line1: text(200),
  line2: text(200).optional(),
  city: text(100),
  region: text(100),
  postalCode: text(20),
  country: z.string().length(2),
  addressId: z.uuid().optional(),
  verified: z.boolean().optional(),
});

export const bySubmission = z.object({ submissionId: id });

/** The revision only keys the client cache; the server always renders the current quote. */
export const packetInput = bySubmission.extend({
  revision: z.number().int().optional(),
  updatedAt: z.string().max(40).optional(),
});

export const customizeQuoteInput = bySubmission.extend({
  selection: z
    .array(
      z.object({
        coverage: text(64).min(1),
        exposure: text(200).optional(),
        limit: amount.optional(),
        deductible: amount.optional(),
      }),
    )
    .max(200),
});

export const bindDetailsInput = bySubmission.extend({
  details: z.object({
    namedInsureds: z.array(text(200)).min(1).max(4),
    mailingAddress: address.nullable(),
    additionalInterests: z
      .array(
        z.object({
          kind: z.enum(INTEREST_KINDS),
          name: text(200),
          address: address.nullable(),
          reference: text(100).optional(),
        }),
      )
      .max(10),
    producer: z.object({
      name: text(200),
      agency: text(200).optional(),
      licenseNumber: text(50).optional(),
    }),
    declinations: z
      .array(z.object({ carrier: text(200), declinedOn: text(10), reason: text(500) }))
      .max(10),
    acknowledgements: z.array(text(64)).max(50),
    homeState: z
      .string()
      .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)
      .optional(),
  }),
});

export const signQuoteInput = bySubmission.extend({
  typedName: text(200).min(1),
  agreed: z.literal(true),
});

export const cardInput = z.object({
  number: z.string().regex(/^[\d ]{12,23}$/),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2000).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/),
  name: text(200).min(1),
  postalCode: text(20).optional(),
});

export const bindQuoteInput = bySubmission
  .extend({
    card: cardInput.optional(),
    paymentToken: z
      .string()
      .regex(/^pm_\w{4,200}$/)
      .optional(),
    autopay: z.boolean().optional(),
  })
  .refine((input) => Boolean(input.card) !== Boolean(input.paymentToken), {
    message: "Send a card or a payment token",
  });

export const choosePayPlanInput = bySubmission.extend({ payPlan: z.string().min(1).max(40) });

export const payPolicyInvoiceInput = z.object({
  policyId: z.uuid(),
  invoiceId: z.uuid(),
  card: cardInput,
});

export const setAutopayInput = z.object({
  policyId: z.uuid(),
  enabled: z.boolean(),
  card: cardInput.optional(),
});

export const decideReferralInput = bySubmission.extend({
  outcome: z.enum(["approve", "decline"]),
  note: text(2000).optional(),
  conditions: z.array(text(500)).max(20).optional(),
});

export const policyById = z.object({ id });
export const policyDocument = z.object({ policyId: id, documentId: id });
export const listPoliciesInput = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .optional();
