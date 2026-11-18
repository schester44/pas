import { authedProcedure, publicProcedure, router } from "./init";

/** app.pas.com: agents, brokers and customers. */
export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  me: authedProcedure.query(({ ctx }) => ({ user: ctx.session.user })),
});

export type AppRouter = typeof appRouter;
