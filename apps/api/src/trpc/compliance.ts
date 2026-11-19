import { OBLIGATION_KINDS } from "@pas/decisions-engine";
import { z } from "zod";
import { requirePermission, router } from "./init";

const read = requirePermission({ compliance: ["read"] });
const write = requirePermission({ compliance: ["write"] });
const byId = z.object({ id: z.uuid() });
const byObligation = z.object({ obligationId: z.uuid() });
const text = (max: number) => z.string().trim().max(max);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

const proofFile = z.object({
  name: text(200).min(1),
  contentType: text(100).min(1),
  base64: z.string().max(Math.ceil((MAX_PROOF_BYTES * 4) / 3) + 4),
});

/** Operate → Compliance: obligations, filings, batches and licensees (PLAN §17). */
export const complianceRouter = router({
  overview: read.query(({ ctx }) =>
    ctx.container.useCases.compliance.obligations.overview(ctx.tenant),
  ),
  list: read
    .input(
      z
        .object({
          view: z.enum(["due", "overdue", "rejected", "done", "all"]).optional(),
          kind: z.enum(OBLIGATION_KINDS).optional(),
          jurisdiction: text(10).optional(),
          licenseeId: text(40).optional(),
          policyId: z.uuid().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      ctx.container.useCases.compliance.obligations.list(ctx.tenant, input ?? {}),
    ),
  get: read
    .input(byId)
    .query(({ ctx, input }) =>
      ctx.container.useCases.compliance.obligation.detail(ctx.tenant, input),
    ),
  proofFile: read.input(byId.extend({ key: text(500).min(1) })).query(async ({ ctx, input }) => {
    const file = await ctx.container.useCases.compliance.obligation.proofFile(ctx.tenant, input);

    return { fileName: file.fileName, contentType: file.contentType, base64: base64(file.body) };
  }),
  submit: write
    .input(byObligation.extend({ providerId: text(64).optional() }))
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.compliance.submit(ctx.tenant, {
        ...input,
        actorName: ctx.session.user.name,
      }),
    ),
  markSubmitted: write
    .input(
      byObligation.extend({
        filingNumber: text(100).optional(),
        note: text(2000).optional(),
        files: z.array(proofFile).max(5),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.compliance.markSubmitted(ctx.tenant, {
        ...input,
        files: input.files.map((f) => ({
          name: f.name,
          contentType: f.contentType,
          body: Buffer.from(f.base64, "base64"),
        })),
        actorName: ctx.session.user.name,
      }),
    ),
  recordResponse: write
    .input(
      z.discriminatedUnion("outcome", [
        byObligation.extend({
          outcome: z.literal("accepted"),
          filingNumber: text(100).optional(),
          stampNumber: text(100).optional(),
        }),
        byObligation.extend({
          outcome: z.literal("rejected"),
          reasons: z.array(text(500).min(1)).min(1).max(10),
        }),
      ]),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.compliance.recordResponse(ctx.tenant, {
        ...input,
        actorName: ctx.session.user.name,
      }),
    ),
  correct: write
    .input(
      byObligation.extend({
        note: text(2000).min(1),
        corrections: z
          .object({ insuredName: text(200), effectiveDate: text(10), expirationDate: text(10) })
          .partial(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.compliance.correct(ctx.tenant, {
        ...input,
        actorName: ctx.session.user.name,
      }),
    ),
  waive: write
    .input(byObligation.extend({ reason: text(2000).min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.compliance.waive(ctx.tenant, {
        ...input,
        approverName: ctx.session.user.name,
      }),
    ),
  exportBatch: write
    .input(
      z.object({
        obligationIds: z.array(z.uuid()).min(1).max(500),
        providerId: text(64).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.compliance.batches.export(ctx.tenant, {
        ...input,
        actorName: ctx.session.user.name,
      }),
    ),
  batches: read.query(({ ctx }) => ctx.container.useCases.compliance.batches.list(ctx.tenant)),
  batchFile: read.input(z.object({ batchId: z.uuid() })).query(async ({ ctx, input }) => {
    const file = await ctx.container.useCases.compliance.batches.file(ctx.tenant, input);

    return { fileName: file.fileName, contentType: file.contentType, base64: base64(file.body) };
  }),
  remittanceReport: read.input(byObligation).query(async ({ ctx, input }) => {
    const report = await ctx.container.useCases.compliance.remittanceReport(ctx.tenant, input);

    return {
      fileName: report.fileName,
      contentType: report.contentType,
      base64: base64(report.body),
      summary: report.summary,
    };
  }),
  licensees: router({
    list: read.query(({ ctx }) => ctx.container.useCases.compliance.licensees.list(ctx.tenant)),
    save: write
      .input(
        z.object({
          id: z.uuid().optional(),
          name: text(200),
          licenseNumber: text(50),
          jurisdiction: z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/),
          active: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.compliance.licensees.save(ctx.tenant, input),
      ),
    remove: write
      .input(byId)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.compliance.licensees.remove(ctx.tenant, input),
      ),
  }),
});
