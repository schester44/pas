import type { Permission } from "@pas/auth";
import { DOWNLOAD_FORMATS } from "@pas/agency-downloads";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bookScopeOf } from "./book-scope";
import type { Context } from "./context";
import { requirePermission, router } from "./init";

const id = z.uuid();
const date = z.iso.date();
const text = (max: number) => z.string().trim().max(max);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const uc = (ctx: Context) => ctx.container.useCases.agencyDownloads;

const staff = (permissions: Permission) =>
  requirePermission(permissions).use(async ({ ctx, next }) => {
    if ((await bookScopeOf(ctx, ctx.tenant)).kind !== "tenant") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return next();
  });

const read = staff({ agency: ["read"] });
const write = staff({ agency: ["write"] });

/** Distribution → Downloads: agency enrollment, the nightly batches, resends and samples. */
export const agencyDownloadsRouter = router({
  overview: read.query(({ ctx }) => uc(ctx).downloads.overview(ctx.tenant)),
  agency: read
    .input(z.object({ agencyId: id }))
    .query(({ ctx, input }) => uc(ctx).downloads.agency(ctx.tenant, input)),
  batch: read
    .input(z.object({ id }))
    .query(({ ctx, input }) => uc(ctx).downloads.batch(ctx.tenant, input)),
  file: read.input(z.object({ id })).query(async ({ ctx, input }) => {
    const file = await uc(ctx).downloads.file(ctx.tenant, input);

    return { fileName: file.fileName, contentType: file.contentType, base64: base64(file.body) };
  }),
  item: read
    .input(z.object({ id }))
    .query(({ ctx, input }) => uc(ctx).downloads.item(ctx.tenant, input)),
  enrollments: read.query(({ ctx }) => uc(ctx).enrollments.list(ctx.tenant)),
  saveEnrollment: write
    .input(
      z.object({
        agencyId: id,
        accountCode: text(10).min(1),
        mailbox: text(8).nullable(),
        agencyCodes: z
          .array(z.object({ carrier: text(80), code: text(40).min(1) }))
          .min(1)
          .max(20),
        enabled: z.boolean(),
        startDate: date,
      }),
    )
    .mutation(({ ctx, input }) => uc(ctx).enrollments.save(ctx.tenant, input)),
  resendBatch: write
    .input(z.object({ batchId: id }))
    .mutation(({ ctx, input }) => uc(ctx).resend.batch(ctx.tenant, input)),
  resendItem: write
    .input(z.object({ itemId: id }))
    .mutation(({ ctx, input }) => uc(ctx).resend.item(ctx.tenant, input)),
  sendStatement: write
    .input(z.object({ agencyId: id, from: date, to: date }))
    .mutation(({ ctx, input }) => uc(ctx).sendStatement(ctx.tenant, input)),
  linesOfBusiness: read.query(({ ctx }) => uc(ctx).samples.linesOfBusiness(ctx.tenant)),
  samples: write
    .input(
      z.object({
        format: z.enum(DOWNLOAD_FORMATS),
        lineOfBusiness: text(80).min(1),
        agencyId: id.optional(),
      }),
    )
    .mutation(({ ctx, input }) => uc(ctx).samples.generate(ctx.tenant, input)),
});
