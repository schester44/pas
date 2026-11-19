import type { TenantContext } from "@pas/kernel";
import { z } from "zod";
import type { Context } from "./context";
import { authedProcedure, router } from "./init";
import { address } from "./quotes-input";

const text = (max: number) => z.string().trim().max(max);

type Session = NonNullable<Context["session"]>;
export type TenantResolver = (ctx: Context & { session: Session }) => Promise<TenantContext>;

/** Suggestions while typing and verification on select, for whichever tenant the surface resolves. */
export function addressRouter(tenantOf: TenantResolver) {
  const procedure = authedProcedure.use(async ({ ctx, next }) =>
    next({ ctx: { ...ctx, tenant: await tenantOf(ctx) } }),
  );

  return router({
    suggest: procedure
      .input(z.object({ text: text(200), selected: text(400).optional() }))
      .query(({ ctx, input }) => ctx.container.useCases.addresses.suggest(ctx.tenant, input)),
    verify: procedure
      .input(z.object({ address }))
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.addresses.resolve(ctx.tenant, input.address),
      ),
  });
}
