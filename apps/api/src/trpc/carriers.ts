import { CAPABILITIES, sampleInput } from "@pas/carriers";
import { newId } from "@pas/kernel";
import { z } from "zod";
import type { Context } from "./context";
import { requirePermission, router } from "./init";
import type { ScopeResolver } from "./policy-changes";

const read = requirePermission({ product: ["read"] });
const write = requirePermission({ product: ["write"] });
const publish = requirePermission({ product: ["publish"] });

const id = z.object({ id: z.string().min(1).max(64) });
const byCarrier = z.object({ carrierId: z.string().uuid() });
const capability = z.enum(CAPABILITIES);
const expression = z.string().max(20_000);
const template = z.string().max(2_000);
const method = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const retry = z.object({
  attempts: z.number().int().min(1).max(10),
  backoff: z.enum(["fixed", "exponential"]),
  delaySeconds: z.number().min(0).max(3600),
});

const httpCall = z.object({
  method,
  path: template,
  headers: z.record(z.string(), template).optional(),
  query: z.record(z.string(), template).optional(),
  body: expression.optional(),
  response: expression.optional(),
  success: expression.optional(),
  errors: z
    .array(z.object({ when: expression, message: template, retry: z.boolean().optional() }))
    .max(20)
    .optional(),
  idempotencyKey: template.optional(),
  retry: retry.optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  anonymous: z.boolean().optional(),
});

const base = { id: z.string().min(1).max(41), name: z.string().max(120).optional() };

const step = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request"), ...base, ...httpCall.shape }),
  z.object({
    kind: z.literal("poll"),
    ...base,
    request: httpCall,
    until: expression,
    intervalSeconds: z.number().positive().max(3600),
    backoffFactor: z.number().min(1).max(10),
    maxIntervalSeconds: z.number().positive().max(86_400),
    maxWaitSeconds: z
      .number()
      .positive()
      .max(7 * 86_400),
  }),
  z.object({
    kind: z.literal("await_callback"),
    ...base,
    correlation: template,
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(30 * 86_400),
    when: expression.optional(),
    response: expression.optional(),
  }),
  z.object({
    kind: z.literal("branch"),
    ...base,
    cases: z.array(z.object({ when: expression, goto: z.string().max(41) })).max(20),
    otherwise: z.string().max(41).optional(),
  }),
  z.object({ kind: z.literal("map"), ...base, expression }),
  z.object({ kind: z.literal("compensate"), ...base, request: httpCall }),
  z.object({ kind: z.literal("fail"), ...base, message: template }),
]);

const flow = z.object({ steps: z.array(step).max(60), output: expression });

export const connectorDefinition = z.object({
  defaults: z.object({
    headers: z.record(z.string(), template),
    timeoutMs: z.number().int().min(100).max(120_000),
    retry,
  }),
  callbacks: z.object({ correlation: expression }),
  capabilities: z.partialRecord(capability, flow),
});

const carrierInput = z.object({
  id: z.string().uuid().optional(),
  key: z.string().min(2).max(63),
  name: z.string().min(1).max(200),
  naic: z.string().max(5).nullish(),
  amBest: z.string().max(20).nullish(),
  admitted: z.array(z.string().max(6)).max(60),
  lines: z.array(z.string().max(80)).max(30),
  mode: z.enum(["connector", "extension", "file_feed"]),
  extensionKey: z.string().max(80).nullish(),
  activeEnvironment: z.enum(["test", "live"]),
  status: z.enum(["active", "inactive"]).optional(),
});

const auth = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("api_key"),
    header: z.string().min(1).max(80),
    prefix: z.string().max(40).optional(),
  }),
  z.object({ kind: z.literal("basic"), username: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal("oauth2_client_credentials"),
    tokenUrl: z.string().url(),
    clientId: z.string().min(1).max(200),
    scope: z.string().max(400).optional(),
  }),
  z.object({ kind: z.literal("mtls") }),
]);

const connectionInput = z.object({
  carrierId: z.string().uuid(),
  environment: z.enum(["test", "live"]),
  baseUrl: z.string().url(),
  auth,
  callback: z.object({
    signature: z.enum(["none", "hmac_sha256"]),
    header: z.string().min(1).max(80),
  }),
  secrets: z.partialRecord(
    z.enum(["apiKey", "password", "clientSecret", "certificate", "privateKey", "callbackSecret"]),
    z.string().max(20_000),
  ),
});

const feedInput = z.object({
  id: z.string().uuid().optional(),
  carrierId: z.string().uuid(),
  name: z.string().min(1).max(120),
  format: z.enum(["bordereaux_csv", "acord_xml"]),
  channel: z.enum(["sftp", "email"]),
  destination: z.object({
    host: z.string().max(200).optional(),
    path: z.string().max(400).optional(),
    username: z.string().max(200).optional(),
    email: z.string().max(320).optional(),
  }),
  schedule: z.enum(["daily", "weekly", "monthly"]),
  status: z.enum(["active", "paused"]),
});

const carriers = (ctx: Context) => ctx.container.carriers;

/** Admin → Carriers: profiles, connections, connector versions, test console, fixtures, feeds. */
export function carriersRouter(staff: ScopeResolver) {
  return router({
    list: read.query(({ ctx }) => carriers(ctx).manage.list(ctx.tenant)),
    get: read.input(id).query(({ ctx, input }) => carriers(ctx).manage.get(ctx.tenant, input)),
    save: write
      .input(carrierInput)
      .mutation(({ ctx, input }) => carriers(ctx).manage.save(ctx.tenant, input)),
    saveConnection: write
      .input(connectionInput)
      .mutation(({ ctx, input }) => carriers(ctx).manage.saveConnection(ctx.tenant, input)),

    connector: router({
      get: read.input(id).query(({ ctx, input }) => carriers(ctx).connector.get(ctx.tenant, input)),
      createDraft: write
        .input(byCarrier.extend({ copyFromId: z.string().uuid().optional() }))
        .mutation(({ ctx, input }) => carriers(ctx).connector.createDraft(ctx.tenant, input)),
      update: write
        .input(id.extend({ definition: connectorDefinition, note: z.string().max(500).nullish() }))
        .mutation(({ ctx, input }) => carriers(ctx).connector.update(ctx.tenant, input)),
      test: write
        .input(id)
        .mutation(({ ctx, input }) => carriers(ctx).connector.test(ctx.tenant, input)),
      publish: publish
        .input(id.extend({ note: z.string().max(500).optional() }))
        .mutation(({ ctx, input }) => carriers(ctx).connector.publish(ctx.tenant, input)),
    }),

    fixtures: router({
      list: read
        .input(byCarrier)
        .query(({ ctx, input }) => carriers(ctx).connector.fixtures(ctx.tenant, input)),
      save: write
        .input(z.object({ flowRunId: z.string().uuid(), name: z.string().max(120) }))
        .mutation(({ ctx, input }) => carriers(ctx).connector.saveFixture(ctx.tenant, input)),
      delete: write
        .input(id)
        .mutation(({ ctx, input }) => carriers(ctx).connector.deleteFixture(ctx.tenant, input)),
    }),

    console: router({
      sample: read
        .input(z.object({ capability }))
        .query(({ input }) => sampleInput(input.capability)),
      run: write
        .input(
          byCarrier.extend({
            versionId: z.string().uuid(),
            capability,
            input: z.record(z.string(), z.unknown()),
          }),
        )
        .mutation(({ ctx, input }) =>
          carriers(ctx).startFlow(ctx.tenant, {
            carrier: { id: input.carrierId },
            capability: input.capability,
            subject: { kind: "test" },
            input: input.input as never,
            idempotencyKey: `test:${newId()}`,
            mode: "test",
            connectorVersionId: input.versionId,
          }),
        ),
    }),

    runs: router({
      list: read
        .input(byCarrier)
        .query(({ ctx, input }) => carriers(ctx).runs.list(ctx.tenant, input)),
      get: read.input(id).query(({ ctx, input }) => carriers(ctx).runs.get(ctx.tenant, input)),
      forQuote: read
        .input(z.object({ quoteId: z.string().uuid() }))
        .query(({ ctx, input }) =>
          carriers(ctx).runs.forSubject(ctx.tenant, { field: "quoteId", id: input.quoteId }),
        ),
      forPolicy: read
        .input(z.object({ policyId: z.string().uuid() }))
        .query(({ ctx, input }) =>
          carriers(ctx).runs.forSubject(ctx.tenant, { field: "policyId", id: input.policyId }),
        ),
    }),

    feeds: router({
      list: read
        .input(byCarrier)
        .query(({ ctx, input }) => carriers(ctx).feeds.list(ctx.tenant, input)),
      save: write
        .input(feedInput)
        .mutation(({ ctx, input }) => carriers(ctx).feeds.save(ctx.tenant, input)),
      run: write
        .input(z.object({ feedId: z.string().uuid() }))
        .mutation(({ ctx, input }) => carriers(ctx).feeds.run(ctx.tenant, { ...input, now: true })),
      download: read
        .input(z.object({ feedId: z.string().uuid(), deliveryId: z.string().uuid() }))
        .query(({ ctx, input }) => carriers(ctx).feeds.download(ctx.tenant, input)),
    }),

    policyLink: requirePermission({ policy: ["read"] })
      .input(z.object({ policyId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { tenant, scope } = await staff(ctx);

        await ctx.container.useCases.policies.get.detail(tenant, scope, { id: input.policyId });

        return carriers(ctx).services.policyLink(tenant, input);
      }),
  });
}
