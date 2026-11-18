import { z } from "zod";
import { authedProcedure, requirePermission, router } from "./init";

/** admin.pas.com: tenant staff (configuration + operations). */
export const adminRouter = router({
  me: authedProcedure.query(({ ctx }) => ({
    user: ctx.session.user,
    activeOrganizationId: ctx.session.session.activeOrganizationId ?? null,
  })),

  catalog: router({
    products: router({
      list: requirePermission({ product: ["read"] }).query(({ ctx }) =>
        ctx.container.useCases.catalog.listProducts(ctx.tenant),
      ),
      create: requirePermission({ product: ["write"] })
        .input(
          z.object({
            key: z.string().min(2).max(63),
            name: z.string().min(1).max(200),
            lineOfBusiness: z.string().min(1).max(100),
          }),
        )
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.createProduct(ctx.tenant, input),
        ),
    }),
  }),
});

export type AdminRouter = typeof adminRouter;
