import { platformProcedure, router } from "./init";

export const platformRouter = router({
  tenants: router({
    list: platformProcedure.query(({ ctx }) =>
      ctx.container.useCases.tenants.listTenants(ctx.platformActor),
    ),
  }),
});

export type PlatformRouter = typeof platformRouter;
