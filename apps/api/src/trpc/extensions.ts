import { EXTENSION_POINTS } from "@pas/extension-points";
import { AUTOMATION_SERVICES, MAX_CPU_MS, MAX_MEMORY_MB } from "@pas/extensions";
import { z } from "zod";
import { requirePermission, router } from "./init";

const read = requirePermission({ extension: ["read"] });
const write = requirePermission({ extension: ["write"] });
const publish = requirePermission({ extension: ["publish"] });

const id = z.uuid();
const point = z.enum(EXTENSION_POINTS);
const json = z.unknown();
const headers = z.record(z.string().max(200), z.string().max(8_000));

const exchange = z.object({
  request: z.object({
    method: z.string().max(10),
    url: z.string().max(4_000),
    headers,
    body: z.string().max(1_000_000).nullable(),
  }),
  response: z.union([
    z.object({
      status: z.number().int(),
      url: z.string().max(4_000),
      headers,
      body: z.string().max(5_000_000),
    }),
    z.object({ error: z.string().max(4_000) }),
  ]),
  durationMs: z.number(),
});

const test = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  point,
  input: json,
  expected: json.optional(),
  expectFailure: z.boolean().optional(),
  network: z.array(exchange).max(50),
});

const manifest = z.object({
  points: z.array(point).max(EXTENSION_POINTS.length),
  services: z.array(z.enum(AUTOMATION_SERVICES)).max(AUTOMATION_SERVICES.length),
  allowedHosts: z.array(z.string().trim().toLowerCase().min(1).max(253)).max(20),
  credentials: z
    .array(
      z.object({
        host: z.string().trim().toLowerCase().min(1).max(253),
        header: z.string().trim().min(1).max(64),
        value: z.string().max(2_000),
      }),
    )
    .max(20),
  liveInSandbox: z.boolean(),
  limits: z.object({
    memoryMb: z.number().int().min(8).max(MAX_MEMORY_MB).optional(),
    cpuMs: z.number().int().min(10).max(MAX_CPU_MS).optional(),
  }),
});

const draft = z.object({
  files: z.record(z.string().max(120), z.string().max(512 * 1024)),
  manifest,
  tests: z.array(test).max(100),
});

/** Admin: author, test, publish and observe tenant extensions (PLAN §15.1). */
export const extensionsRouter = router({
  list: read.query(({ ctx }) => ctx.container.extensions.list(ctx.tenant)),
  get: read
    .input(z.object({ id }))
    .query(({ ctx, input }) => ctx.container.extensions.get(ctx.tenant, input)),
  create: write
    .input(
      z.object({
        key: z.string().trim().min(2).max(48),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.container.extensions.create(ctx.tenant, input)),
  update: write
    .input(
      z.object({
        id,
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).nullish(),
        draft: draft.partial().optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.container.extensions.update(ctx.tenant, input)),
  archive: write
    .input(z.object({ id, archived: z.boolean() }))
    .mutation(({ ctx, input }) => ctx.container.extensions.archive(ctx.tenant, input)),
  setSecret: write
    .input(
      z.object({
        extensionId: id,
        name: z.string().trim().min(1).max(64),
        value: z.string().min(1).max(8_192),
      }),
    )
    .mutation(({ ctx, input }) => ctx.container.extensions.setSecret(ctx.tenant, input)),
  removeSecret: write
    .input(z.object({ extensionId: id, name: z.string().min(1).max(64) }))
    .mutation(({ ctx, input }) => ctx.container.extensions.removeSecret(ctx.tenant, input)),
  test: write
    .input(
      z.object({
        id,
        record: z.boolean().optional(),
        testIds: z.array(z.string().max(64)).max(100).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.container.extensions.test(ctx.tenant, input)),
  try: write
    .input(z.object({ id, point, input: json, live: z.boolean() }))
    .mutation(({ ctx, input }) => ctx.container.extensions.try(ctx.tenant, input)),
  publish: publish
    .input(z.object({ id, note: z.string().trim().max(500).nullish() }))
    .mutation(({ ctx, input }) => ctx.container.extensions.publish(ctx.tenant, input)),
  version: read
    .input(z.object({ id }))
    .query(({ ctx, input }) => ctx.container.extensions.getVersion(ctx.tenant, input)),
  versionChoices: requirePermission({ product: ["read"] })
    .input(z.object({ point: point.optional() }))
    .query(({ ctx, input }) => ctx.container.extensions.versionChoices(ctx.tenant, input)),
  saveSubscription: publish
    .input(
      z.object({
        id: id.optional(),
        extensionId: id,
        extensionVersionId: id,
        eventTypes: z.array(z.string().trim().max(80)).min(1).max(30),
        condition: z.string().max(2_000).nullish(),
        enabled: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.container.extensions.saveSubscription(ctx.tenant, input)),
  deleteSubscription: publish
    .input(z.object({ id }))
    .mutation(({ ctx, input }) => ctx.container.extensions.deleteSubscription(ctx.tenant, input)),
  runs: read
    .input(
      z.object({
        extensionId: id.optional(),
        subject: z.object({ type: z.string().max(40), id: z.string().max(64) }).optional(),
        status: z.enum(["succeeded", "failed", "invalid_output"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => ctx.container.extensions.listRuns(ctx.tenant, input)),
  run: read
    .input(z.object({ id }))
    .query(({ ctx, input }) => ctx.container.extensions.getRun(ctx.tenant, input)),
});

const values = z.record(z.string().max(300), z.unknown());

export const fieldExtensionInput = z.object({
  submissionId: id,
  field: z.string().min(1).max(300),
  path: z.string().min(1).max(400).optional(),
  values,
});

export const recordPanelInput = z.object({ bindingId: z.string().min(1).max(64) });
export const recordActionInput = recordPanelInput.extend({
  values: z.record(z.string().max(64), z.unknown()),
});
