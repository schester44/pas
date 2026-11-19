import { SUBJECTIVITY_OWNERS, SUBJECTIVITY_TIMINGS } from "@pas/decisions-engine";
import { INSPECTION_VIEWS, QUEUE_VIEWS, REVIEW_OUTCOMES } from "@pas/underwriting";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireAppPermission } from "./app-tenant";
import { bookScopeOf } from "./book-scope";
import { requirePermission, router } from "./init";

const read = requirePermission({ uw: ["read"] });
const decide = requirePermission({ uw: ["approve"] });
const configure = requirePermission({ uw: ["override"] });
const byId = z.object({ id: z.uuid() });
const text = (max: number) => z.string().trim().max(max);
const message = text(4000).min(1);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const MAX_FILE = 5 * 1024 * 1024;
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

const file = z.object({
  name: text(200).min(1),
  contentType: text(100).min(1),
  base64: z.string().max(Math.ceil((MAX_FILE * 4) / 3) + 4),
});

const amount = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), amount: decimal, currency: z.string().length(3) }),
  z.object({ kind: z.literal("percent"), value: decimal }),
]);

const terms = z.object({
  coverages: z
    .array(
      z.object({
        coverage: text(64).min(1),
        exposure: text(200).optional(),
        limit: amount.optional(),
        deductible: amount.optional(),
      }),
    )
    .max(50),
  adjustment: z
    .object({
      percent: decimal.refine((v) => Math.abs(Number(v)) <= 100, "Keep it within ±100%"),
      reason: text(500).min(1),
    })
    .nullable(),
});

const subjectivity = z.object({
  title: text(300).min(1),
  description: text(2000).optional(),
  timing: z.enum(SUBJECTIVITY_TIMINGS),
  dueDays: z.number().int().min(0).max(365).optional(),
  owner: z.enum(SUBJECTIVITY_OWNERS),
});

const settings = z.object({
  authorityProfiles: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]*$/, "Use lower_snake_case"),
        name: text(100).min(1),
        level: z.number().int().min(1).max(10),
        maxPremium: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .nullable(),
        maxInsuredValue: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .nullable(),
        products: z.array(z.uuid()),
        jurisdictions: z.array(text(10)),
        roles: z.array(text(64)),
        userIds: z.array(text(64)),
      }),
    )
    .max(20),
  declineReasons: z
    .array(
      z.object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "Use UPPER_SNAKE_CASE"),
        label: text(200).min(1),
        adverseActionNotice: text(4000),
      }),
    )
    .max(50),
  overdueConsequence: text(300).nullable(),
});

/** Operate → Underwriting: the referral queue, subjectivities, inspections and authority. */
export const underwritingRouter = router({
  queue: read
    .input(
      z.object({
        view: z.enum(QUEUE_VIEWS).optional(),
        productId: z.uuid().optional(),
        jurisdiction: text(10).optional(),
        olderThanHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 90)
          .optional(),
        assigneeId: text(64).optional(),
      }),
    )
    .query(({ ctx, input }) => ctx.container.useCases.underwriting.queue(ctx.tenant, input)),
  referral: read
    .input(byId)
    .query(({ ctx, input }) =>
      ctx.container.useCases.underwriting.referral.detail(ctx.tenant, input),
    ),
  forQuote: read
    .input(z.object({ quoteId: z.uuid() }))
    .query(({ ctx, input }) =>
      ctx.container.useCases.underwriting.referral.forQuote(ctx.tenant, input),
    ),
  assign: decide
    .input(byId.extend({ assigneeId: text(64).nullable() }))
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.assign(ctx.tenant, {
        ...input,
        actorName: ctx.session.user.name,
      }),
    ),
  requestInfo: decide.input(byId.extend({ message })).mutation(({ ctx, input }) =>
    ctx.container.useCases.underwriting.requestInfo(ctx.tenant, {
      ...input,
      actorName: ctx.session.user.name,
    }),
  ),
  note: read.input(byId.extend({ message })).mutation(({ ctx, input }) =>
    ctx.container.useCases.underwriting.note(ctx.tenant, {
      ...input,
      actorName: ctx.session.user.name,
    }),
  ),
  approve: decide
    .input(
      byId.extend({
        note: text(2000).optional(),
        conditions: z.array(text(500).min(1)).max(20),
        terms,
        subjectivities: z.array(subjectivity).max(20),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.approve(ctx.tenant, {
        ...input,
        ...(input.note && { note: input.note }),
        actorName: ctx.session.user.name,
      }),
    ),
  decline: decide
    .input(
      byId.extend({ reasonCodes: z.array(text(64)).min(1).max(10), note: text(2000).optional() }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.decline(ctx.tenant, {
        ...input,
        ...(input.note && { note: input.note }),
        actorName: ctx.session.user.name,
      }),
    ),

  subjectivities: router({
    forQuote: read
      .input(z.object({ quoteId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.underwriting.subjectivities.forQuote(ctx.tenant, input),
      ),
    forPolicy: read
      .input(z.object({ policyId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.underwriting.subjectivities.forPolicy(ctx.tenant, input),
      ),
    open: read.query(({ ctx }) =>
      ctx.container.useCases.underwriting.subjectivities.open(ctx.tenant),
    ),
    add: decide.input(subjectivity.extend({ submissionId: z.uuid() })).mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.subjectivities.add(ctx.tenant, {
        ...input,
        ...(input.description && { description: input.description }),
        ...(input.dueDays !== undefined && { dueDays: input.dueDays }),
        actorName: ctx.session.user.name,
      }),
    ),
    accept: decide.input(byId.extend({ note: text(1000).optional() })).mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.subjectivities.accept(ctx.tenant, {
        id: input.id,
        ...(input.note && { note: input.note }),
        actorName: ctx.session.user.name,
      }),
    ),
    waive: decide.input(byId.extend({ reason: text(1000).min(1) })).mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.subjectivities.waive(ctx.tenant, {
        ...input,
        actorName: ctx.session.user.name,
      }),
    ),
    reopen: decide.input(byId.extend({ note: text(1000).min(1) })).mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.subjectivities.reopen(ctx.tenant, {
        ...input,
        actorName: ctx.session.user.name,
      }),
    ),
    upload: decide.input(byId.extend({ file })).mutation(({ ctx, input }) =>
      ctx.container.useCases.underwriting.subjectivities.upload(ctx.tenant, {
        id: input.id,
        name: input.file.name,
        contentType: input.file.contentType,
        body: Buffer.from(input.file.base64, "base64"),
        actorName: ctx.session.user.name,
      }),
    ),
    document: read.input(byId.extend({ key: text(500).min(1) })).query(async ({ ctx, input }) => {
      const doc = await ctx.container.useCases.underwriting.subjectivities.document(
        ctx.tenant,
        input,
      );

      return { fileName: doc.fileName, contentType: doc.contentType, base64: base64(doc.body) };
    }),
  }),

  inspections: router({
    list: read
      .input(z.object({ view: z.enum(INSPECTION_VIEWS).optional() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.underwriting.inspections.list(ctx.tenant, input),
      ),
    forQuote: read
      .input(z.object({ quoteId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.underwriting.inspections.forQuote(ctx.tenant, input),
      ),
    forPolicy: read
      .input(z.object({ policyId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.underwriting.inspections.forPolicy(ctx.tenant, input),
      ),
    get: read
      .input(byId)
      .query(({ ctx, input }) =>
        ctx.container.useCases.underwriting.inspections.get(ctx.tenant, input),
      ),
    review: decide
      .input(
        byId.extend({
          outcome: z.enum(REVIEW_OUTCOMES),
          note: text(2000).optional(),
          subjectivityCodes: z.array(text(64)).max(20),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.underwriting.reviewInspection(ctx.tenant, {
          ...input,
          ...(input.note && { note: input.note }),
          actorName: ctx.session.user.name,
        }),
      ),
  }),

  settings: router({
    get: read.query(({ ctx }) => ctx.container.useCases.underwriting.settings.get(ctx.tenant)),
    update: configure
      .input(settings)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.underwriting.settings.update(ctx.tenant, input),
      ),
    staff: read.query(async ({ ctx }) =>
      (await ctx.container.useCases.underwriting.staff.list(ctx.tenant)).map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        roles: m.roles,
      })),
    ),
  }),
});

const inBook = (permissions: Parameters<typeof requireAppPermission>[0]) =>
  requireAppPermission(permissions).use(async ({ ctx, next }) =>
    next({ ctx: { ...ctx, scope: await bookScopeOf(ctx, ctx.tenant) } }),
  );

const bySubmission = z.object({ submissionId: z.uuid() });

/** The producer's side in the agent app: status, the conversation, and subjectivity uploads. */
export const producerUnderwritingRouter = router({
  referral: inBook({ quote: ["read"] })
    .input(bySubmission)
    .query(async ({ ctx, input }) => {
      const quote = await ctx.container.useCases.quotes.get.forProducer(
        ctx.tenant,
        ctx.scope,
        input,
      );

      return quote
        ? ctx.container.useCases.underwriting.referral.forProducer(ctx.tenant, {
            quoteId: quote.id,
          })
        : null;
    }),
  reply: inBook({ submission: ["update"] })
    .input(bySubmission.extend({ message }))
    .mutation(async ({ ctx, input }) => {
      const quote = await ctx.container.useCases.quotes.get.forProducer(
        ctx.tenant,
        ctx.scope,
        input,
      );

      if (!quote) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.container.useCases.underwriting.reply(ctx.tenant, {
        quoteId: quote.id,
        message: input.message,
        actorName: ctx.session.user.name,
      });
    }),
  subjectivities: inBook({ quote: ["read"] })
    .input(bySubmission)
    .query(async ({ ctx, input }) => {
      const quote = await ctx.container.useCases.quotes.get.forProducer(
        ctx.tenant,
        ctx.scope,
        input,
      );

      return quote
        ? ctx.container.useCases.underwriting.subjectivities.forQuote(ctx.tenant, {
            quoteId: quote.id,
          })
        : [];
    }),
  policySubjectivities: inBook({ policy: ["read"] })
    .input(z.object({ policyId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await ctx.container.useCases.policies.get.detail(ctx.tenant, ctx.scope, {
        id: input.policyId,
      });

      return ctx.container.useCases.underwriting.subjectivities.forPolicy(ctx.tenant, input);
    }),
  upload: inBook({ quote: ["read"] })
    .input(bySubmission.extend({ subjectivityId: z.uuid(), file }))
    .mutation(async ({ ctx, input }) => {
      const quote = await ctx.container.useCases.quotes.get.forProducer(
        ctx.tenant,
        ctx.scope,
        input,
      );

      const mine =
        quote &&
        (await ctx.container.useCases.underwriting.subjectivities.forQuote(ctx.tenant, {
          quoteId: quote.id,
        }));

      if (!mine?.some((s) => s.id === input.subjectivityId))
        throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.container.useCases.underwriting.subjectivities.upload(ctx.tenant, {
        id: input.subjectivityId,
        name: input.file.name,
        contentType: input.file.contentType,
        body: Buffer.from(input.file.base64, "base64"),
        actorName: ctx.session.user.name,
      });
    }),
});
