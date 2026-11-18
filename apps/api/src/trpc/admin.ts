import { seesTenantBook } from "@pas/auth";
import { asId } from "@pas/kernel";
import type { SubmissionScope } from "@pas/submissions";
import { z } from "zod";
import {
  byId,
  byProduct,
  resolveReleaseInput,
  updateVersionInput,
  versionLabel,
} from "./catalog-input";
import {
  assertPermission,
  authedProcedure,
  requirePermission,
  router,
  tenantProcedure,
} from "./init";
import { listSubmissionsInput, submissionById } from "./submissions-input";

const submissionRead = requirePermission({ submission: ["read"] }).use(async ({ ctx, next }) => {
  const { role } = await ctx.container.auth.api.getActiveMemberRole({ headers: ctx.headers });

  const scope: SubmissionScope = seesTenantBook(role)
    ? { kind: "tenant" }
    : { kind: "producer", producerId: asId(ctx.session.user.id) };

  return next({ ctx: { ...ctx, scope } });
});

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
      get: requirePermission({ product: ["read"] })
        .input(byId)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.getProduct(ctx.tenant, input)),
    }),

    versions: router({
      list: requirePermission({ product: ["read"] })
        .input(byProduct)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.listVersions(ctx.tenant, input)),
      get: requirePermission({ product: ["read"] })
        .input(byId)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.getVersion(ctx.tenant, input)),
      check: requirePermission({ product: ["read"] })
        .input(byId)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.checkVersion(ctx.tenant, input)),
      create: requirePermission({ product: ["write"] })
        .input(byProduct.extend({ version: versionLabel }))
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.createVersion(ctx.tenant, input),
        ),
      copy: requirePermission({ product: ["write"] })
        .input(byId.extend({ version: versionLabel }))
        .mutation(async ({ ctx, input }) => {
          const source = await ctx.container.useCases.catalog.getVersion(ctx.tenant, input);

          return ctx.container.useCases.catalog.createVersion(ctx.tenant, {
            productId: source.productId,
            version: input.version,
            copyFromId: input.id,
          });
        }),
      update: tenantProcedure.input(updateVersionInput).mutation(async ({ ctx, input }) => {
        const { id: _, documents, ...product } = input;

        if (documents) await assertPermission(ctx, { document: ["write"] });

        if (Object.keys(product).length > 0 || !documents) {
          await assertPermission(ctx, { product: ["write"] });
        }

        return ctx.container.useCases.catalog.updateVersion(ctx.tenant, input);
      }),
      submitForReview: requirePermission({ product: ["write"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.submitVersion(ctx.tenant, input),
        ),
      returnToDraft: requirePermission({ product: ["write"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.reopenVersion(ctx.tenant, input),
        ),
      publish: requirePermission({ product: ["publish"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.publishVersion(ctx.tenant, input),
        ),
      retire: requirePermission({ product: ["publish"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.retireVersion(ctx.tenant, input),
        ),
    }),

    releases: router({
      list: requirePermission({ product: ["read"] })
        .input(byProduct)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.listReleases(ctx.tenant, input)),
      resolve: requirePermission({ product: ["read"] })
        .input(resolveReleaseInput)
        .query(({ ctx, input }) =>
          ctx.container.useCases.catalog.resolveRelease(ctx.tenant, input),
        ),
    }),
  }),

  documents: router({
    formEditions: router({
      list: requirePermission({ document: ["read"] }).query(({ ctx }) =>
        ctx.container.useCases.formLibrary.list(ctx.tenant),
      ),
    }),
  }),

  submissions: router({
    list: submissionRead
      .input(listSubmissionsInput)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.list(ctx.tenant, ctx.scope, input),
      ),
    get: submissionRead
      .input(submissionById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.get(ctx.tenant, ctx.scope, input),
      ),
  }),

  tenant: router({
    profile: router({
      get: tenantProcedure.query(({ ctx }) =>
        ctx.container.useCases.tenants.getProfile(ctx.tenant),
      ),
      update: requirePermission({ organization: ["update"] })
        .input(
          z.object({
            displayName: z.string().max(120),
            primaryColor: z.string().max(7),
            logoUrl: z.string().max(2000).nullable(),
            appSubdomain: z.string().max(63),
            customDomains: z.array(z.string().max(253)).max(10),
            supportEmail: z.string().max(254).nullable(),
            supportPhone: z.string().max(40).nullable(),
          }),
        )
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.tenants.updateProfile(ctx.tenant, input),
        ),
    }),
  }),
});

export type AdminRouter = typeof adminRouter;
