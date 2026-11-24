import { asId, type TenantContext } from "@pas/kernel";
import type { ClientIdentity } from "@pas/submissions";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { appTenantProcedure } from "./app-tenant";
import type { Context } from "./context";
import { publicProcedure, router } from "./init";
import { cardInput } from "./quotes-input";

const token = z.string().min(10).max(200);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const hostTenant = async (ctx: Context): Promise<TenantContext> => {
  const resolved = await ctx.container.useCases.tenants.resolveTenantByHost({
    host:
      ctx.headers.get("x-pas-host") ??
      ctx.headers.get("x-forwarded-host") ??
      ctx.headers.get("host") ??
      "",
    slug: ctx.headers.get("x-pas-tenant"),
  });

  if (resolved.status !== "tenant") {
    throw new TRPCError({ code: "NOT_FOUND", message: "No tenant for this address" });
  }

  return {
    tenantId: asId(resolved.tenantId),
    actor: { type: "system", process: "client-application-link" },
  };
};

/** Any signed-in user on the host; the use cases check they're who the link was sent to. */
const clientProcedure = appTenantProcedure.use(({ ctx, next }) => {
  const { user } = ctx.session;

  const identity: ClientIdentity = {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
  };

  return next({ ctx: { ...ctx, identity } });
});

/** The insured's side of an application the producer sent them (`/apply/:token`). */
export const applyRouter = router({
  peek: publicProcedure
    .input(z.object({ token }))
    .query(async ({ ctx, input }) =>
      ctx.container.useCases.clientApplication.peek(await hostTenant(ctx), input),
    ),
  get: clientProcedure.input(z.object({ token })).query(({ ctx, input }) =>
    ctx.container.useCases.clientApplication.get(ctx.tenant, {
      ...input,
      identity: ctx.identity,
    }),
  ),
  acceptDisclosures: clientProcedure
    .input(z.object({ token, codes: z.array(z.string().min(1).max(64)).min(1).max(50) }))
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.clientApplication.acceptDisclosures(ctx.tenant, {
        ...input,
        identity: ctx.identity,
      }),
    ),
  packet: clientProcedure
    .input(z.object({ token, revision: z.number().int(), updatedAt: z.string() }))
    .query(async ({ ctx, input }) => {
      const packet = await ctx.container.useCases.clientApplication.packet(ctx.tenant, {
        token: input.token,
        identity: ctx.identity,
      });

      return { pdf: base64(packet.pdf), documents: packet.documents, revision: packet.revision };
    }),
  sign: clientProcedure
    .input(
      z.object({ token, typedName: z.string().trim().min(1).max(200), agreed: z.literal(true) }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.clientApplication.sign(ctx.tenant, {
        ...input,
        ...ctx.client,
        identity: ctx.identity,
      }),
    ),
  checkout: clientProcedure.query(({ ctx }) => ctx.container.useCases.quotes.checkout(ctx.tenant)),
  pay: clientProcedure
    .input(
      z
        .object({
          token,
          card: cardInput.optional(),
          paymentToken: z
            .string()
            .regex(/^pm_\w{4,200}$/)
            .optional(),
          autopay: z.boolean().optional(),
        })
        .refine((i) => Boolean(i.card) !== Boolean(i.paymentToken), {
          message: "Send a card or a payment token",
        }),
    )
    .mutation(({ ctx, input }) =>
      ctx.container.useCases.clientApplication.pay(ctx.tenant, {
        token: input.token,
        identity: ctx.identity,
        method: input.paymentToken
          ? { kind: "token", token: input.paymentToken }
          : { kind: "card", ...input.card! },
        autopay: input.autopay ?? false,
      }),
    ),
});
