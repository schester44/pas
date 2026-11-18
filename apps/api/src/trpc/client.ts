import { CHANGE_KINDS } from "@pas/parties";
import { z } from "zod";
import { appTenantProcedure } from "./app-tenant";
import { router } from "./init";
import { cardInput } from "./quotes-input";

const id = z.uuid();
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * The client portal (PLAN §7.7): any signed-in user on the tenant's host, never by membership.
 * Every procedure runs under the ClientScope resolved from the user's linked client accounts.
 */
const clientProcedure = appTenantProcedure.use(async ({ ctx, next }) => {
  const { user } = ctx.session;

  const identity = { userId: user.id, email: user.email, emailVerified: user.emailVerified };
  const scope = await ctx.container.useCases.parties.resolveScope(ctx.tenant, identity);

  const name = async () =>
    user.name ||
    (await ctx.container.useCases.parties.profile(ctx.tenant, scope)).accounts[0]?.displayName ||
    user.email;

  return next({ ctx: { ...ctx, identity, scope, name } });
});

export const clientRouter = router({
  me: clientProcedure.query(async ({ ctx }) => {
    const profile = await ctx.container.useCases.parties.profile(ctx.tenant, ctx.scope);

    return {
      user: { name: await ctx.name(), email: ctx.session.user.email },
      ...profile,
      linked: profile.accounts.length > 0,
    };
  }),

  policies: router({
    list: clientProcedure.query(({ ctx }) =>
      ctx.container.useCases.parties.policies(ctx.tenant, ctx.scope),
    ),
    get: clientProcedure
      .input(z.object({ id }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.parties.policy.detail(ctx.tenant, ctx.scope, input),
      ),
  }),

  documents: router({
    download: clientProcedure
      .input(z.object({ policyId: id, documentId: id }))
      .query(async ({ ctx, input }) => {
        const file = await ctx.container.useCases.parties.policy.document(
          ctx.tenant,
          ctx.scope,
          input,
        );

        return { fileName: file.fileName, title: file.title, pdf: base64(file.body) };
      }),
  }),

  invoices: router({
    list: clientProcedure.query(({ ctx }) =>
      ctx.container.useCases.parties.invoices.list(ctx.tenant, ctx.scope),
    ),
    get: clientProcedure
      .input(z.object({ id }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.parties.invoices.get(ctx.tenant, ctx.scope, input),
      ),
    pay: clientProcedure.input(z.object({ id, card: cardInput })).mutation(async ({ ctx, input }) =>
      ctx.container.useCases.parties.invoices.pay(ctx.tenant, ctx.scope, {
        ...input,
        payerName: await ctx.name(),
      }),
    ),
  }),

  changeRequests: router({
    create: clientProcedure
      .input(
        z.object({
          policyId: id,
          kind: z.enum(CHANGE_KINDS),
          details: z.string().trim().min(3).max(2000),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        ctx.container.useCases.parties.requestChange(ctx.tenant, ctx.scope, {
          ...input,
          requester: {
            name: await ctx.name(),
            email: ctx.session.user.email,
          },
        }),
      ),
  }),

  claim: router({
    verify: clientProcedure
      .input(
        z.object({
          policyNumber: z.string().trim().min(3).max(40),
          postalCode: z.string().trim().min(3).max(12),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.container.useCases.parties.claim(ctx.tenant, ctx.identity, input);

        return result.status === "linked"
          ? { status: result.status, policyCount: result.scope.policyIds.length }
          : result;
      }),
  }),
});
