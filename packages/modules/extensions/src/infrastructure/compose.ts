import type { ClockProvider, Outbox, TenantContext, UnitOfWork, Workflows } from "@pas/kernel";
import { HttpSandboxClient } from "@pas/sandbox/client";
import { makeArchiveExtension } from "../application/archive-extension";
import { makeCreateExtension } from "../application/create-extension";
import type { ExtensionDeps } from "../application/deps";
import { makeDispatchAutomations, makeRunAutomation } from "../application/dispatch-automations";
import {
  makeEnrichmentTransforms,
  makeResolveTransform,
} from "../application/enrichment-transforms";
import { makeExtensionRater } from "../application/extension-rater";
import { makeGetExtension, makeGetExtensionVersion } from "../application/get-extension";
import { makeBindingInvoker } from "../application/invoke-binding";
import { makeListExtensionRuns, makeGetExtensionRun } from "../application/list-extension-runs";
import { makeListExtensions } from "../application/list-extensions";
import { makeListVersionChoices } from "../application/list-version-choices";
import { makeRemoveExtensionSecret, makeSetExtensionSecret } from "../application/manage-secrets";
import { makeDeleteSubscription, makeSaveSubscription } from "../application/manage-subscriptions";
import { makePublishExtensionVersion } from "../application/publish-extension-version";
import { makePurgeExtensionRuns } from "../application/purge-extension-runs";
import { makeRunExtension } from "../application/run-extension";
import { makeTestExtension, makeTryExtension } from "../application/test-extension";
import { makeUpdateExtension } from "../application/update-extension";
import { makeVerifyBindings } from "../application/verify-bindings";
import type { AutomationServices, SecretBox } from "../ports/services";
import { EsbuildExtensionCompiler } from "./esbuild-compiler";
import { PrismaExtensionRepository } from "./prisma-extension-repository";
import { PrismaExtensionRunRepository } from "./prisma-run-repository";
import { PrismaSubscriptionRepository } from "./prisma-subscription-repository";
import { SandboxExtensionRunner } from "./sandbox-runner";

export interface ExtensionCompositionDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  secretBox: SecretBox;
  isSandbox: (ctx: TenantContext) => Promise<boolean>;
  sandbox: { url: string; token: string };
  /** Local dev only: lets extensions call localhost services. */
  allowPrivateNetwork?: boolean;
  automationServices?: AutomationServices;
  /** Where automation runs execute; only the worker dispatches them. */
  workflows?: () => Workflows;
}

const noServices: AutomationServices = { build: () => ({}) };

export function sandboxSettingsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const development = env.NODE_ENV === "development";
  const token = env.SANDBOX_TOKEN ?? (development ? "dev-sandbox-token" : undefined);

  if (!token) throw new Error("SANDBOX_TOKEN is required");

  return {
    sandbox: { url: env.SANDBOX_URL ?? "http://localhost:4100", token },
    allowPrivateNetwork: development && env.EXTENSIONS_ALLOW_PRIVATE_NETWORK === "true",
  };
}

export function composeExtensions(input: ExtensionCompositionDeps) {
  const deps: ExtensionDeps = {
    uow: input.uow,
    outbox: input.outbox,
    clocks: input.clocks,
    extensions: new PrismaExtensionRepository(),
    subscriptions: new PrismaSubscriptionRepository(),
    runs: new PrismaExtensionRunRepository(),
    secrets: input.secretBox,
    compiler: new EsbuildExtensionCompiler(),
    runner: new SandboxExtensionRunner(new HttpSandboxClient(input.sandbox), {
      allowPrivateNetwork: input.allowPrivateNetwork ?? false,
    }),
    environments: { isSandbox: input.isSandbox },
  };

  const runExtension = makeRunExtension(deps);
  const invoker = makeBindingInvoker(runExtension);
  const resolveTransform = makeResolveTransform(deps);

  return {
    create: makeCreateExtension(deps),
    update: makeUpdateExtension(deps),
    archive: makeArchiveExtension(deps),
    list: makeListExtensions(deps),
    get: makeGetExtension(deps),
    getVersion: makeGetExtensionVersion(deps),
    setSecret: makeSetExtensionSecret(deps),
    removeSecret: makeRemoveExtensionSecret(deps),
    test: makeTestExtension(deps),
    try: makeTryExtension(deps),
    publish: makePublishExtensionVersion(deps),
    versionChoices: makeListVersionChoices(deps),
    saveSubscription: makeSaveSubscription(deps),
    deleteSubscription: makeDeleteSubscription(deps),
    listRuns: makeListExtensionRuns(deps),
    getRun: makeGetExtensionRun(deps),
    purgeRuns: makePurgeExtensionRuns(deps),
    verifyBindings: makeVerifyBindings(deps),
    run: runExtension,
    invoker,
    rater: makeExtensionRater(invoker),
    resolveTransform,
    enrichmentTransforms: makeEnrichmentTransforms({ resolve: resolveTransform, runExtension }),
    dispatchAutomations: makeDispatchAutomations({
      ...deps,
      ...(input.workflows && { workflows: input.workflows }),
    }),
    runAutomation: makeRunAutomation({
      ...deps,
      runExtension,
      services: input.automationServices ?? noServices,
    }),
  };
}

export type Extensions = ReturnType<typeof composeExtensions>;
